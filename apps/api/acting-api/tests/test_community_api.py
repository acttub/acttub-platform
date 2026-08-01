"""커뮤니티·프로필 라우터의 HTTP 계약.

스토어 동작은 test_community_store.py 가 실제 Postgres 로 검증한다. 여기서는 그 결과가
어떤 상태 코드로 번역되는지, 그리고 입력 검증이 어디서 막히는지만 본다.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient

from acting_agent.config import Settings as AgentSettings
from acting_api.app import create_app
from acting_api.auth.jwt import JwtService
from acting_api.config import GatewaySettings
from acting_api.db.community_store import (
    Author,
    CategoryNotFound,
    Comment,
    CommentNotFound,
    DuplicateReport,
    NotAuthor,
    Page,
    Post,
    PostNotFound,
)
from acting_api.storage import S3Storage
from acting_report.config import Settings as ReportSettings
from acting_summary.config import Settings as SummarySettings
from api_test_support import FakeClient
from platform_test_support import FakeBotoS3Client, FakePlatformStore

JWT_SECRET = "community-api-test-secret"

NOW = datetime(2026, 8, 1, 9, 0, tzinfo=timezone.utc)


def _post(author_id: UUID, *, post_id: UUID | None = None, mine: bool = False) -> Post:
    return Post(
        id=post_id or uuid4(),
        category_slug="free",
        category_name="자유",
        author=Author(id=author_id, nickname="글쓴이"),
        title="제목",
        body="본문",
        like_count=0,
        comment_count=0,
        view_count=0,
        liked_by_me=False,
        mine=mine,
        created_at=NOW,
        updated_at=NOW,
    )


def _comment(author_id: UUID, post_id: UUID) -> Comment:
    return Comment(
        id=uuid4(),
        post_id=post_id,
        author=Author(id=author_id, nickname="댓쓴이"),
        body="댓글",
        mine=False,
        created_at=NOW,
        updated_at=NOW,
    )


@dataclass
class Raises:
    """다음 호출에서 던질 예외. 라우터의 번역만 보면 되므로 이걸로 충분하다."""

    error: Exception


class StubCommunityStore:
    def __init__(self):
        self.author_id = uuid4()
        self.raise_with: Exception | None = None
        self.view_increments: list[UUID] = []
        self.unblocked: list[tuple[UUID, UUID]] = []
        self.reports: list[dict] = []
        # 익명 독자가 정말 익명으로 내려오는지 확인하려고 마지막 viewer 를 남긴다.
        self.last_viewer_id: UUID | None = None

    def _maybe_raise(self):
        if self.raise_with is not None:
            error, self.raise_with = self.raise_with, None
            raise error

    def list_categories(self):
        self._maybe_raise()
        return []

    def list_posts(self, **kwargs):
        self._maybe_raise()
        self.last_viewer_id = kwargs.get("viewer_id")
        return Page(items=[_post(self.author_id)], next_cursor="next")

    def create_post(self, **kwargs):
        self._maybe_raise()
        return _post(self.author_id, mine=True)

    def get_post(self, post_id, *, viewer_id=None):
        self._maybe_raise()
        return _post(self.author_id, post_id=post_id)

    def increment_view_count(self, post_id):
        self.view_increments.append(post_id)

    def update_post(self, **kwargs):
        self._maybe_raise()
        return _post(self.author_id, post_id=kwargs["post_id"], mine=True)

    def delete_post(self, **kwargs):
        self._maybe_raise()

    def like_post(self, **kwargs):
        self._maybe_raise()
        return 1

    def unlike_post(self, **kwargs):
        self._maybe_raise()
        return 0

    def list_comments(self, **kwargs):
        self._maybe_raise()
        return Page(
            items=[_comment(self.author_id, kwargs["post_id"])], next_cursor=None
        )

    def create_comment(self, **kwargs):
        self._maybe_raise()
        return _comment(self.author_id, kwargs["post_id"])

    def update_comment(self, **kwargs):
        self._maybe_raise()
        return _comment(self.author_id, uuid4())

    def delete_comment(self, **kwargs):
        self._maybe_raise()

    def create_report(self, **kwargs):
        self._maybe_raise()
        self.reports.append(kwargs)

    def list_blocks(self, blocker_id):
        self._maybe_raise()
        return [Author(id=self.author_id, nickname="차단된이")]

    def block_user(self, **kwargs):
        self._maybe_raise()

    def unblock_user(self, **kwargs):
        self.unblocked.append((kwargs["blocker_id"], kwargs["blocked_id"]))


def _application():
    store = FakePlatformStore()
    community = StubCommunityStore()
    app = create_app(
        client=FakeClient(),
        gateway_settings=GatewaySettings(
            database_url="postgresql+psycopg://unused/unused",
            jwt_secret=JWT_SECRET,
        ),
        summary_settings=SummarySettings(api_key="k", model="model-test"),
        agent_settings=AgentSettings(api_key="k", model="model-test"),
        report_settings=ReportSettings(api_key="k", model="model-test"),
        store=store,
        community_store=community,
        s3_storage=S3Storage(bucket="videos", client=FakeBotoS3Client()),
    )
    user = store.create_user(email="actor@example.com")
    headers = {
        "Authorization": f"Bearer {JwtService(JWT_SECRET).issue_access_token(user.id).value}"
    }
    return TestClient(app), store, community, user, headers


def test_reading_works_without_logging_in():
    client, _, _, _, _ = _application()

    assert client.get("/v2/community/posts").status_code == 200
    assert client.get("/v2/community/categories").status_code == 200
    assert client.get(f"/v2/community/posts/{uuid4()}").status_code == 200
    assert client.get(f"/v2/community/posts/{uuid4()}/comments").status_code == 200


def test_writing_still_requires_logging_in():
    client, _, _, _, _ = _application()

    assert (
        client.post(
            "/v2/community/posts",
            json={"category_slug": "free", "title": "제목", "body": "본문"},
        ).status_code
        == 401
    )
    assert client.post(f"/v2/community/posts/{uuid4()}/likes").status_code == 401
    assert (
        client.post(
            f"/v2/community/posts/{uuid4()}/comments", json={"body": "댓글"}
        ).status_code
        == 401
    )
    assert client.get("/v2/community/blocks").status_code == 401


def test_stale_token_is_not_downgraded_to_anonymous():
    """만료·손상된 토큰은 401 이어야 클라이언트가 refresh 를 돈다."""
    client, _, _, _, _ = _application()

    response = client.get(
        "/v2/community/posts", headers={"Authorization": "Bearer not-a-token"}
    )

    assert response.status_code == 401


def test_anonymous_reader_is_never_the_author():
    client, _, community, _, _ = _application()

    body = client.get("/v2/community/posts").json()

    assert body["posts"][0]["mine"] is False
    assert community.last_viewer_id is None


def test_post_list_carries_cursor():
    client, _, _, _, headers = _application()

    response = client.get("/v2/community/posts", headers=headers)

    assert response.status_code == 200
    body = response.json()
    assert body["next_cursor"] == "next"
    assert body["posts"][0]["author"]["nickname"] == "글쓴이"


def test_broken_cursor_is_a_client_error():
    client, _, community, _, headers = _application()
    community.raise_with = ValueError("invalid_cursor")

    response = client.get("/v2/community/posts?cursor=zzz", headers=headers)

    assert response.status_code == 400


def test_unknown_category_on_create_is_not_found():
    client, _, community, _, headers = _application()
    community.raise_with = CategoryNotFound("nope")

    response = client.post(
        "/v2/community/posts",
        headers=headers,
        json={"category_slug": "nope", "title": "제목", "body": "본문"},
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "category_not_found"


def test_created_post_is_201():
    client, _, _, _, headers = _application()

    response = client.post(
        "/v2/community/posts",
        headers=headers,
        json={"category_slug": "free", "title": "  제목  ", "body": "본문"},
    )

    assert response.status_code == 201
    assert response.json()["mine"] is True


def test_blank_title_is_rejected_before_the_store():
    client, _, _, _, headers = _application()

    response = client.post(
        "/v2/community/posts",
        headers=headers,
        json={"category_slug": "free", "title": "   ", "body": "본문"},
    )

    assert response.status_code == 422


def test_unknown_field_is_rejected():
    client, _, _, _, headers = _application()

    response = client.post(
        "/v2/community/posts",
        headers=headers,
        json={
            "category_slug": "free",
            "title": "제목",
            "body": "본문",
            "pinned": True,
        },
    )

    assert response.status_code == 422


def test_reading_someone_elses_post_counts_a_view():
    client, _, community, _, headers = _application()
    post_id = uuid4()

    client.get(f"/v2/community/posts/{post_id}", headers=headers)

    assert community.view_increments == [post_id]


def test_editing_someone_elses_post_is_forbidden():
    client, _, community, _, headers = _application()
    community.raise_with = NotAuthor("x")

    response = client.patch(
        f"/v2/community/posts/{uuid4()}",
        headers=headers,
        json={"title": "제목", "body": "본문"},
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "not_author"


def test_missing_post_on_delete_is_not_found():
    client, _, community, _, headers = _application()
    community.raise_with = PostNotFound("x")

    response = client.delete(f"/v2/community/posts/{uuid4()}", headers=headers)

    assert response.status_code == 404


def test_delete_returns_no_content():
    client, _, _, _, headers = _application()

    response = client.delete(f"/v2/community/posts/{uuid4()}", headers=headers)

    assert response.status_code == 204


def test_like_and_unlike_report_the_flag():
    client, _, _, _, headers = _application()
    post_id = uuid4()

    liked = client.post(f"/v2/community/posts/{post_id}/likes", headers=headers)
    unliked = client.delete(f"/v2/community/posts/{post_id}/likes", headers=headers)

    assert liked.json() == {"like_count": 1, "liked_by_me": True}
    assert unliked.json() == {"like_count": 0, "liked_by_me": False}


def test_comment_on_missing_post_is_not_found():
    client, _, community, _, headers = _application()
    community.raise_with = PostNotFound("x")

    response = client.post(
        f"/v2/community/posts/{uuid4()}/comments",
        headers=headers,
        json={"body": "댓글"},
    )

    assert response.status_code == 404


def test_missing_comment_on_edit_is_not_found():
    client, _, community, _, headers = _application()
    community.raise_with = CommentNotFound("x")

    response = client.patch(
        f"/v2/community/comments/{uuid4()}", headers=headers, json={"body": "고침"}
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "comment_not_found"


def test_duplicate_report_is_a_conflict():
    client, _, community, _, headers = _application()
    community.raise_with = DuplicateReport("x")

    response = client.post(
        "/v2/community/reports",
        headers=headers,
        json={
            "target_type": "post",
            "target_id": str(uuid4()),
            "reason": "spam",
            "detail": None,
        },
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "already_reported"


def test_reporting_your_own_post_is_a_bad_request():
    client, _, community, _, headers = _application()
    community.raise_with = NotAuthor("x")

    response = client.post(
        "/v2/community/reports",
        headers=headers,
        json={
            "target_type": "post",
            "target_id": str(uuid4()),
            "reason": "spam",
            "detail": None,
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "cannot_report_own"


def test_unknown_report_reason_is_rejected():
    client, _, _, _, headers = _application()

    response = client.post(
        "/v2/community/reports",
        headers=headers,
        json={
            "target_type": "post",
            "target_id": str(uuid4()),
            "reason": "because",
            "detail": None,
        },
    )

    assert response.status_code == 422


def test_blocking_yourself_is_a_bad_request():
    client, _, community, _, headers = _application()
    community.raise_with = NotAuthor("x")

    response = client.post(
        "/v2/community/blocks", headers=headers, json={"user_id": str(uuid4())}
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "cannot_block_self"


def test_unblock_passes_the_pair_through():
    client, _, community, user, headers = _application()
    blocked = uuid4()

    response = client.delete(f"/v2/community/blocks/{blocked}", headers=headers)

    assert response.status_code == 204
    assert community.unblocked == [(user.id, blocked)]


def test_block_list_is_returned():
    client, _, _, _, headers = _application()

    response = client.get("/v2/community/blocks", headers=headers)

    assert response.status_code == 200
    assert response.json()["blocks"][0]["nickname"] == "차단된이"


def test_me_returns_the_current_nickname():
    client, store, _, user, headers = _application()
    store.update_user_nickname(user.id, "지윤")

    response = client.get("/v2/me", headers=headers)

    assert response.status_code == 200
    assert response.json()["nickname"] == "지윤"


def test_me_starts_without_a_nickname():
    client, _, _, _, headers = _application()

    assert client.get("/v2/me", headers=headers).json()["nickname"] is None


def test_nickname_is_saved_and_whitespace_is_collapsed():
    client, store, _, user, headers = _application()

    response = client.patch("/v2/me", headers=headers, json={"nickname": "  지  윤  "})

    assert response.status_code == 200
    assert response.json()["nickname"] == "지 윤"
    assert store.get_user(user.id).nickname == "지 윤"


def test_blank_nickname_is_rejected():
    client, _, _, _, headers = _application()

    assert (
        client.patch("/v2/me", headers=headers, json={"nickname": "   "}).status_code
        == 422
    )


def test_overlong_nickname_is_rejected():
    client, _, _, _, headers = _application()

    response = client.patch("/v2/me", headers=headers, json={"nickname": "가" * 21})

    assert response.status_code == 422


def test_me_requires_authentication():
    client, _, _, _, _ = _application()

    assert client.get("/v2/me").status_code == 401
