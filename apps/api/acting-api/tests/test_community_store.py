"""CommunityStore 를 실제 PostgreSQL 에 대고 검증한다.

가짜 Session 을 쓰는 라우터 테스트는 SQL 을 실행하지 않는다. 부분 인덱스, ON CONFLICT
제약 이름, 커서 부등호처럼 Postgres 만 거부할 수 있는 것들이 여기서 잡힌다.
"""

from __future__ import annotations

from uuid import uuid4

import pytest
from sqlalchemy import inspect, text

from acting_api.db.community_store import (
    CategoryNotFound,
    CommentNotFound,
    CommunityStore,
    DuplicateReport,
    NotAuthor,
    PostNotFound,
    decode_cursor,
    encode_cursor,
)
from acting_api.db.models import ReportReason, ReportTargetType
from acting_api.db.store import PostgresStore
from db_test_support import migrated_database, postgres_schema  # noqa: F401

pytestmark = pytest.mark.db


@pytest.fixture
def stores(migrated_database):  # noqa: F811
    store = PostgresStore.from_url(migrated_database)
    community = CommunityStore.from_store(store)
    try:
        yield store, community
    finally:
        store.close()


@pytest.fixture
def actors(stores):
    store, community = stores
    writer = store.create_user(email="writer@example.com")
    store.update_user_nickname(writer.id, "글쓴이")
    reader = store.create_user(email="reader@example.com")
    store.update_user_nickname(reader.id, "읽는이")
    return store, community, writer, reader


def _post(community, author, *, title="제목", body="본문", slug="free"):
    return community.create_post(
        author_id=author.id, category_slug=slug, title=title, body=body
    )


def test_migration_seeds_three_categories(stores):
    _, community = stores
    slugs = [category.slug for category in community.list_categories()]
    assert slugs == ["free", "admission", "info"]


def test_migration_creates_community_enums(stores):
    store, _ = stores
    with store.engine.connect() as connection:
        enum_names = set(
            connection.scalars(
                text(
                    "SELECT typname FROM pg_type WHERE typnamespace = "
                    "(SELECT oid FROM pg_namespace WHERE nspname = current_schema())"
                )
            )
        )
    assert {
        "content_status_t",
        "report_target_type_t",
        "report_reason_t",
        "report_status_t",
    } <= enum_names


def test_users_gained_nickname_column(stores):
    store, _ = stores
    columns = {column["name"] for column in inspect(store.engine).get_columns("users")}
    assert "nickname" in columns


def test_created_post_appears_in_list_with_author_nickname(actors):
    _, community, writer, reader = actors
    created = _post(community, writer, title="첫 글")

    page = community.list_posts(viewer_id=reader.id)

    assert [item.id for item in page.items] == [created.id]
    assert page.items[0].author.nickname == "글쓴이"
    assert page.items[0].mine is False
    assert page.items[0].category_name == "자유"


def test_list_filters_by_category(actors):
    _, community, writer, reader = actors
    free_post = _post(community, writer, slug="free")
    _post(community, writer, slug="admission")

    page = community.list_posts(viewer_id=reader.id, category_slug="free")

    assert [item.id for item in page.items] == [free_post.id]


def test_unknown_category_is_rejected(actors):
    _, community, writer, _ = actors
    with pytest.raises(CategoryNotFound):
        _post(community, writer, slug="does-not-exist")


def test_cursor_walks_every_post_exactly_once(actors):
    _, community, writer, reader = actors
    created = [_post(community, writer, title=f"글 {index}") for index in range(7)]

    seen = []
    cursor = None
    while True:
        page = community.list_posts(viewer_id=reader.id, cursor=cursor, limit=2)
        seen.extend(item.id for item in page.items)
        cursor = page.next_cursor
        if cursor is None:
            break

    assert seen == [post.id for post in reversed(created)]


def test_cursor_roundtrip_keeps_time_and_id(actors):
    _, community, writer, _ = actors
    post = _post(community, writer)
    stamp, row_id = decode_cursor(encode_cursor(post.created_at, post.id))
    assert (stamp, row_id) == (post.created_at, post.id)


def test_broken_cursor_is_reported_as_value_error(actors):
    _, community, _, reader = actors
    with pytest.raises(ValueError):
        community.list_posts(viewer_id=reader.id, cursor="not-a-cursor")


def test_author_can_edit_own_post(actors):
    _, community, writer, _ = actors
    post = _post(community, writer)

    updated = community.update_post(
        post_id=post.id, author_id=writer.id, title="고친 제목", body="고친 본문"
    )

    assert (updated.title, updated.body) == ("고친 제목", "고친 본문")


def test_editing_someone_elses_post_is_refused(actors):
    _, community, writer, reader = actors
    post = _post(community, writer)

    with pytest.raises(NotAuthor):
        community.update_post(
            post_id=post.id, author_id=reader.id, title="가로채기", body="가로채기"
        )


def test_deleting_someone_elses_post_is_refused(actors):
    _, community, writer, reader = actors
    post = _post(community, writer)

    with pytest.raises(NotAuthor):
        community.delete_post(post_id=post.id, author_id=reader.id)


def test_deleted_post_leaves_list_and_detail(actors):
    _, community, writer, reader = actors
    post = _post(community, writer)

    community.delete_post(post_id=post.id, author_id=writer.id)

    assert community.list_posts(viewer_id=reader.id).items == []
    with pytest.raises(PostNotFound):
        community.get_post(post.id, viewer_id=reader.id)


def test_like_counts_once_per_user(actors):
    _, community, writer, reader = actors
    post = _post(community, writer)

    assert community.like_post(post_id=post.id, user_id=reader.id) == 1
    assert community.like_post(post_id=post.id, user_id=reader.id) == 1
    assert community.get_post(post.id, viewer_id=reader.id).liked_by_me is True


def test_unlike_restores_count_and_flag(actors):
    _, community, writer, reader = actors
    post = _post(community, writer)
    community.like_post(post_id=post.id, user_id=reader.id)

    assert community.unlike_post(post_id=post.id, user_id=reader.id) == 0
    assert community.get_post(post.id, viewer_id=reader.id).liked_by_me is False


def test_unlike_without_like_does_not_go_negative(actors):
    _, community, writer, reader = actors
    post = _post(community, writer)

    assert community.unlike_post(post_id=post.id, user_id=reader.id) == 0


def test_comment_count_tracks_comments(actors):
    _, community, writer, reader = actors
    post = _post(community, writer)

    comment = community.create_comment(
        post_id=post.id, author_id=reader.id, body="좋은 글이에요"
    )
    assert community.get_post(post.id, viewer_id=writer.id).comment_count == 1

    community.delete_comment(comment_id=comment.id, author_id=reader.id)
    assert community.get_post(post.id, viewer_id=writer.id).comment_count == 0
    assert community.list_comments(post_id=post.id, viewer_id=writer.id).items == []


def test_comments_page_oldest_first(actors):
    _, community, writer, reader = actors
    post = _post(community, writer)
    created = [
        community.create_comment(
            post_id=post.id, author_id=reader.id, body=f"댓글 {index}"
        )
        for index in range(5)
    ]

    seen = []
    cursor = None
    while True:
        page = community.list_comments(
            post_id=post.id, viewer_id=writer.id, cursor=cursor, limit=2
        )
        seen.extend(item.id for item in page.items)
        cursor = page.next_cursor
        if cursor is None:
            break

    assert seen == [comment.id for comment in created]


def test_editing_someone_elses_comment_is_refused(actors):
    _, community, writer, reader = actors
    post = _post(community, writer)
    comment = community.create_comment(
        post_id=post.id, author_id=reader.id, body="원문"
    )

    with pytest.raises(NotAuthor):
        community.update_comment(
            comment_id=comment.id, author_id=writer.id, body="가로채기"
        )


def test_comment_on_missing_post_is_rejected(actors):
    _, community, _, reader = actors
    with pytest.raises(PostNotFound):
        community.create_comment(post_id=uuid4(), author_id=reader.id, body="어디에?")


def test_missing_comment_is_reported(actors):
    _, community, _, reader = actors
    with pytest.raises(CommentNotFound):
        community.update_comment(comment_id=uuid4(), author_id=reader.id, body="없음")


def test_blocked_author_disappears_from_list_and_detail(actors):
    _, community, writer, reader = actors
    post = _post(community, writer)

    community.block_user(blocker_id=reader.id, blocked_id=writer.id)

    assert community.list_posts(viewer_id=reader.id).items == []
    with pytest.raises(PostNotFound):
        community.get_post(post.id, viewer_id=reader.id)
    # 차단은 차단한 사람 눈에서만 적용된다 — 글쓴이 본인에게는 그대로 보인다.
    assert [item.id for item in community.list_posts(viewer_id=writer.id).items] == [
        post.id
    ]


def test_blocked_author_comments_disappear(actors):
    _, community, writer, reader = actors
    post = _post(community, reader)
    community.create_comment(post_id=post.id, author_id=writer.id, body="숨을 댓글")

    community.block_user(blocker_id=reader.id, blocked_id=writer.id)

    assert community.list_comments(post_id=post.id, viewer_id=reader.id).items == []


def test_unblock_brings_posts_back(actors):
    _, community, writer, reader = actors
    post = _post(community, writer)
    community.block_user(blocker_id=reader.id, blocked_id=writer.id)

    community.unblock_user(blocker_id=reader.id, blocked_id=writer.id)

    assert [item.id for item in community.list_posts(viewer_id=reader.id).items] == [
        post.id
    ]


def test_block_list_names_the_blocked_user(actors):
    _, community, writer, reader = actors
    community.block_user(blocker_id=reader.id, blocked_id=writer.id)

    blocks = community.list_blocks(reader.id)

    assert [(item.id, item.nickname) for item in blocks] == [(writer.id, "글쓴이")]


def test_blocking_yourself_is_refused(actors):
    _, community, _, reader = actors
    with pytest.raises(NotAuthor):
        community.block_user(blocker_id=reader.id, blocked_id=reader.id)


def test_double_block_is_idempotent(actors):
    _, community, writer, reader = actors
    community.block_user(blocker_id=reader.id, blocked_id=writer.id)
    community.block_user(blocker_id=reader.id, blocked_id=writer.id)

    assert len(community.list_blocks(reader.id)) == 1


def test_report_is_accepted_once_per_target(actors):
    _, community, writer, reader = actors
    post = _post(community, writer)

    community.create_report(
        reporter_id=reader.id,
        target_type=ReportTargetType.POST,
        target_id=post.id,
        reason=ReportReason.SPAM,
        detail=None,
    )

    with pytest.raises(DuplicateReport):
        community.create_report(
            reporter_id=reader.id,
            target_type=ReportTargetType.POST,
            target_id=post.id,
            reason=ReportReason.ABUSE,
            detail="또 신고",
        )


def test_reporting_your_own_post_is_refused(actors):
    _, community, writer, _ = actors
    post = _post(community, writer)

    with pytest.raises(NotAuthor):
        community.create_report(
            reporter_id=writer.id,
            target_type=ReportTargetType.POST,
            target_id=post.id,
            reason=ReportReason.OTHER,
            detail=None,
        )


def test_comment_can_be_reported(actors):
    _, community, writer, reader = actors
    post = _post(community, writer)
    comment = community.create_comment(
        post_id=post.id, author_id=writer.id, body="신고될 댓글"
    )

    community.create_report(
        reporter_id=reader.id,
        target_type=ReportTargetType.COMMENT,
        target_id=comment.id,
        reason=ReportReason.ABUSE,
        detail="심한 말",
    )


def test_view_count_increments(actors):
    _, community, writer, reader = actors
    post = _post(community, writer)

    community.increment_view_count(post.id)
    community.increment_view_count(post.id)

    assert community.get_post(post.id, viewer_id=reader.id).view_count == 2
