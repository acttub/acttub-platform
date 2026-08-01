"""커뮤니티 게시판 질의.

`store.py` 와 분리해 둔 이유: 그 파일은 이미 2,000줄이 넘어 손대기 어렵다. 게시판은
기존 도메인과 공유하는 상태가 없으므로 같은 엔진만 넘겨받아 따로 산다.

읽는 쪽 규칙 두 가지가 전 질의에 걸린다.
- 삭제·숨김된 글과 댓글은 목록에서 빠진다 (행은 남는다 — 신고 처리에 원문이 필요).
- 차단한 상대의 글·댓글은 차단한 사람 눈에서만 사라진다.
"""

from __future__ import annotations

import base64
from dataclasses import dataclass
from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import Engine, delete, func, or_, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from acting_api.db.engine import create_session_factory
from acting_api.db.models import (
    CommunityAnonymousAlias,
    CommunityBlock,
    CommunityCategory,
    CommunityComment,
    CommunityPost,
    CommunityPostLike,
    CommunityReport,
    ContentStatus,
    ReportReason,
    ReportStatus,
    ReportTargetType,
    User,
)

DEFAULT_PAGE_SIZE = 20
MAX_PAGE_SIZE = 50


class CategoryNotFound(LookupError):
    pass


class PostNotFound(LookupError):
    pass


class CommentNotFound(LookupError):
    pass


class NotAuthor(PermissionError):
    """남의 글·댓글을 고치거나 지우려 했다."""


class DuplicateReport(RuntimeError):
    """같은 대상을 두 번 신고했다. 조용히 성공시키지 않고 호출자가 알게 한다."""


@dataclass(frozen=True)
class Category:
    id: UUID
    slug: str
    name: str
    description: str | None
    sort_order: int


ANONYMOUS_POST_LABEL = "익명"
ANONYMOUS_AUTHOR_LABEL = "글쓴이"


@dataclass(frozen=True)
class Author:
    """익명이면 `id`·`nickname` 이 비고 `alias` 만 찬다.

    익명 글에 실제 user id 를 실어 보내면 화면에 "익명" 이라고 써 있어도 클라이언트가
    같은 id 로 다른 글과 묶어버린다 — 익명이 아니게 된다. 그래서 아예 담지 않는다.
    """

    id: UUID | None
    nickname: str | None
    alias: str | None = None

    @classmethod
    def named(cls, user) -> Author:
        return cls(id=user.id, nickname=user.nickname, alias=None)

    @classmethod
    def anonymous(cls, alias: str) -> Author:
        return cls(id=None, nickname=None, alias=alias)


@dataclass(frozen=True)
class Post:
    id: UUID
    category_slug: str
    category_name: str
    author: Author
    title: str
    body: str
    like_count: int
    comment_count: int
    view_count: int
    liked_by_me: bool
    mine: bool
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class Comment:
    id: UUID
    post_id: UUID
    author: Author
    body: str
    mine: bool
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class Page:
    """커서 페이지네이션 결과. `next_cursor` 가 None 이면 끝이다."""

    items: list
    next_cursor: str | None


def encode_cursor(created_at: datetime, row_id: UUID) -> str:
    """(시각, id) 를 한 문자열로 접는다. id 를 같이 넣어야 동시각 글에서 안 겹친다."""
    raw = f"{created_at.isoformat()}|{row_id}".encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def decode_cursor(cursor: str) -> tuple[datetime, UUID]:
    padding = "=" * (-len(cursor) % 4)
    try:
        raw = base64.urlsafe_b64decode(cursor + padding).decode()
        stamp, _, row_id = raw.partition("|")
        return datetime.fromisoformat(stamp), UUID(row_id)
    except (ValueError, UnicodeDecodeError) as exc:
        raise ValueError("invalid_cursor") from exc


def _not_blocked(table, blocked):
    """차단 필터. 익명 글·댓글은 일부러 통과시킨다.

    익명까지 걸러내면 차단 전후로 사라진 글을 비교해 "이 익명이 그 사람" 이라는 걸
    알아낼 수 있다. 차단은 이름 붙은 글을 안 보겠다는 뜻이고, 익명 글에는 애초에 그
    사람의 이름이 붙어 있지 않다.
    """
    return or_(table.anonymous.is_(True), table.author_id.not_in(blocked))


def _clamp_limit(limit: int | None) -> int:
    if limit is None:
        return DEFAULT_PAGE_SIZE
    return max(1, min(limit, MAX_PAGE_SIZE))


class CommunityStore:
    def __init__(self, engine: Engine):
        self._engine = engine
        self._session_factory: sessionmaker[Session] = create_session_factory(engine)

    @classmethod
    def from_store(cls, store) -> CommunityStore:
        return cls(store.engine)

    # ---- 차단 목록 (다른 질의의 재료) ----

    def _blocked_ids_subquery(self, viewer_id: UUID | None):
        if viewer_id is None:
            return None
        return select(CommunityBlock.blocked_id).where(
            CommunityBlock.blocker_id == viewer_id
        )

    # ---- 카테고리 ----

    def list_categories(self) -> list[Category]:
        with self._session_factory() as db:
            rows = db.scalars(
                select(CommunityCategory)
                .where(CommunityCategory.is_active.is_(True))
                .order_by(CommunityCategory.sort_order, CommunityCategory.slug)
            ).all()
            return [
                Category(
                    id=row.id,
                    slug=row.slug,
                    name=row.name,
                    description=row.description,
                    sort_order=row.sort_order,
                )
                for row in rows
            ]

    def _category_by_slug(self, db: Session, slug: str) -> CommunityCategory:
        row = db.scalar(
            select(CommunityCategory).where(
                CommunityCategory.slug == slug,
                CommunityCategory.is_active.is_(True),
            )
        )
        if row is None:
            raise CategoryNotFound(slug)
        return row

    # ---- 글 ----

    def _post_from_row(self, row, *, viewer_id: UUID | None, liked: bool) -> Post:
        post, category, author = row
        # 글 작성자는 한 명뿐이라 번호가 필요 없다. 그냥 "익명".
        shown = (
            Author.anonymous(ANONYMOUS_POST_LABEL)
            if post.anonymous
            else Author.named(author)
        )
        return Post(
            id=post.id,
            category_slug=category.slug,
            category_name=category.name,
            author=shown,
            title=post.title,
            body=post.body,
            like_count=post.like_count,
            comment_count=post.comment_count,
            view_count=post.view_count,
            liked_by_me=liked,
            mine=viewer_id is not None and author.id == viewer_id,
            created_at=post.created_at,
            updated_at=post.updated_at,
        )

    def list_posts(
        self,
        *,
        viewer_id: UUID | None = None,
        category_slug: str | None = None,
        cursor: str | None = None,
        limit: int | None = None,
    ) -> Page:
        size = _clamp_limit(limit)
        with self._session_factory() as db:
            query = (
                select(CommunityPost, CommunityCategory, User)
                .join(CommunityCategory, CommunityCategory.id == CommunityPost.category_id)
                .join(User, User.id == CommunityPost.author_id)
                .where(CommunityPost.status == ContentStatus.VISIBLE)
            )
            if category_slug is not None:
                query = query.where(CommunityCategory.slug == category_slug)
            blocked = self._blocked_ids_subquery(viewer_id)
            if blocked is not None:
                query = query.where(_not_blocked(CommunityPost, blocked))
            if cursor is not None:
                stamp, row_id = decode_cursor(cursor)
                # 같은 시각이면 id 로 가른다 — 그래야 글이 건너뛰거나 겹치지 않는다.
                query = query.where(
                    or_(
                        CommunityPost.created_at < stamp,
                        (CommunityPost.created_at == stamp)
                        & (CommunityPost.id < row_id),
                    )
                )
            rows = db.execute(
                query.order_by(
                    CommunityPost.created_at.desc(), CommunityPost.id.desc()
                ).limit(size + 1)
            ).all()

            has_more = len(rows) > size
            rows = rows[:size]
            liked_ids: set[UUID] = set()
            if viewer_id is not None and rows:
                liked_ids = set(
                    db.scalars(
                        select(CommunityPostLike.post_id).where(
                            CommunityPostLike.user_id == viewer_id,
                            CommunityPostLike.post_id.in_([r[0].id for r in rows]),
                        )
                    ).all()
                )
            items = [
                self._post_from_row(
                    row, viewer_id=viewer_id, liked=row[0].id in liked_ids
                )
                for row in rows
            ]
            next_cursor = (
                encode_cursor(rows[-1][0].created_at, rows[-1][0].id)
                if has_more and rows
                else None
            )
            return Page(items=items, next_cursor=next_cursor)

    def get_post(self, post_id: UUID, *, viewer_id: UUID | None = None) -> Post:
        with self._session_factory() as db:
            row = self._load_post_row(db, post_id, viewer_id=viewer_id)
            liked = False
            if viewer_id is not None:
                liked = (
                    db.scalar(
                        select(func.count())
                        .select_from(CommunityPostLike)
                        .where(
                            CommunityPostLike.post_id == post_id,
                            CommunityPostLike.user_id == viewer_id,
                        )
                    )
                    or 0
                ) > 0
            return self._post_from_row(row, viewer_id=viewer_id, liked=liked)

    def _load_post_row(self, db: Session, post_id: UUID, *, viewer_id: UUID | None):
        query = (
            select(CommunityPost, CommunityCategory, User)
            .join(CommunityCategory, CommunityCategory.id == CommunityPost.category_id)
            .join(User, User.id == CommunityPost.author_id)
            .where(
                CommunityPost.id == post_id,
                CommunityPost.status == ContentStatus.VISIBLE,
            )
        )
        blocked = self._blocked_ids_subquery(viewer_id)
        if blocked is not None:
            query = query.where(_not_blocked(CommunityPost, blocked))
        row = db.execute(query).first()
        if row is None:
            raise PostNotFound(post_id)
        return row

    def create_post(
        self,
        *,
        author_id: UUID,
        category_slug: str,
        title: str,
        body: str,
        anonymous: bool = False,
    ) -> Post:
        with self._session_factory.begin() as db:
            category = self._category_by_slug(db, category_slug)
            post = CommunityPost(
                id=uuid4(),
                category_id=category.id,
                author_id=author_id,
                title=title,
                body=body,
                anonymous=anonymous,
            )
            db.add(post)
            db.flush()
            author = db.get(User, author_id)
            return self._post_from_row(
                (post, category, author), viewer_id=author_id, liked=False
            )

    def update_post(
        self, *, post_id: UUID, author_id: UUID, title: str, body: str
    ) -> Post:
        with self._session_factory.begin() as db:
            post = db.get(CommunityPost, post_id)
            if post is None or post.status != ContentStatus.VISIBLE:
                raise PostNotFound(post_id)
            if post.author_id != author_id:
                raise NotAuthor(post_id)
            post.title = title
            post.body = body
            post.updated_at = func.now()
            db.flush()
            db.refresh(post)
            category = db.get(CommunityCategory, post.category_id)
            author = db.get(User, author_id)
            liked = (
                db.scalar(
                    select(func.count())
                    .select_from(CommunityPostLike)
                    .where(
                        CommunityPostLike.post_id == post_id,
                        CommunityPostLike.user_id == author_id,
                    )
                )
                or 0
            ) > 0
            return self._post_from_row(
                (post, category, author), viewer_id=author_id, liked=liked
            )

    def delete_post(self, *, post_id: UUID, author_id: UUID) -> None:
        with self._session_factory.begin() as db:
            post = db.get(CommunityPost, post_id)
            if post is None or post.status == ContentStatus.DELETED:
                raise PostNotFound(post_id)
            if post.author_id != author_id:
                raise NotAuthor(post_id)
            post.status = ContentStatus.DELETED
            post.updated_at = func.now()

    def increment_view_count(self, post_id: UUID) -> None:
        """중복 방지를 하지 않는다 — 지금 트래픽에서 세션 추적은 과설계다."""
        with self._session_factory.begin() as db:
            db.execute(
                update(CommunityPost)
                .where(CommunityPost.id == post_id)
                .values(view_count=CommunityPost.view_count + 1)
            )

    # ---- 좋아요 ----

    def _resync_like_count(self, db: Session, post: CommunityPost) -> int:
        """좋아요 수를 세어서 다시 박는다.

        증감으로 처리하지 않는 이유: ORM insert 의 rowcount 로는 "정말 새로 들어갔는지"
        를 가릴 수 없어서, 같은 사람이 두 번 누르면 숫자가 두 번 올라갔다. 행 수가
        언제나 정답이고, post_id 인덱스가 있어 세는 값도 싸다.
        """
        post.like_count = (
            select(func.count())
            .select_from(CommunityPostLike)
            .where(CommunityPostLike.post_id == post.id)
            .scalar_subquery()
        )
        db.flush()
        db.refresh(post)
        return post.like_count

    def like_post(self, *, post_id: UUID, user_id: UUID) -> int:
        with self._session_factory.begin() as db:
            post = db.get(CommunityPost, post_id)
            if post is None or post.status != ContentStatus.VISIBLE:
                raise PostNotFound(post_id)
            db.execute(
                insert(CommunityPostLike)
                .values(id=uuid4(), post_id=post_id, user_id=user_id)
                .on_conflict_do_nothing(constraint="uq_community_post_likes")
            )
            return self._resync_like_count(db, post)

    def unlike_post(self, *, post_id: UUID, user_id: UUID) -> int:
        with self._session_factory.begin() as db:
            post = db.get(CommunityPost, post_id)
            if post is None or post.status != ContentStatus.VISIBLE:
                raise PostNotFound(post_id)
            db.execute(
                delete(CommunityPostLike).where(
                    CommunityPostLike.post_id == post_id,
                    CommunityPostLike.user_id == user_id,
                )
            )
            return self._resync_like_count(db, post)

    # ---- 댓글 ----

    def _comment_from_row(
        self, row, *, viewer_id: UUID | None, post, aliases: dict[UUID, int]
    ) -> Comment:
        comment, author = row
        if comment.anonymous:
            shown = Author.anonymous(
                self._comment_alias(comment, post=post, aliases=aliases)
            )
        else:
            shown = Author.named(author)
        return Comment(
            id=comment.id,
            post_id=comment.post_id,
            author=shown,
            body=comment.body,
            mine=viewer_id is not None and author.id == viewer_id,
            created_at=comment.created_at,
            updated_at=comment.updated_at,
        )

    def _comment_alias(self, comment, *, post, aliases: dict[UUID, int]) -> str:
        """익명 댓글에 붙일 이름.

        글쓴이 표시는 **글도 익명일 때만** 준다. 실명으로 올린 글에 글쓴이가 익명
        댓글을 달았는데 "글쓴이" 라고 적으면, 그 익명이 곧 위에 이름이 적힌 사람이라고
        알려주는 꼴이라 익명이 깨진다.
        """
        if post.anonymous and comment.author_id == post.author_id:
            return ANONYMOUS_AUTHOR_LABEL
        ordinal = aliases.get(comment.author_id)
        # 번호를 못 찾더라도 실명으로 되돌리지는 않는다.
        return f"{ANONYMOUS_POST_LABEL}{ordinal}" if ordinal else ANONYMOUS_POST_LABEL

    def _alias_map(self, db: Session, post_id: UUID) -> dict[UUID, int]:
        rows = db.execute(
            select(
                CommunityAnonymousAlias.user_id, CommunityAnonymousAlias.ordinal
            ).where(CommunityAnonymousAlias.post_id == post_id)
        ).all()
        return {user_id: ordinal for user_id, ordinal in rows}

    def _ensure_alias(self, db: Session, *, post_id: UUID, user_id: UUID) -> int:
        """이 글에서 쓸 익명 번호를 발급하거나 이미 받은 번호를 돌려준다."""
        existing = db.scalar(
            select(CommunityAnonymousAlias.ordinal).where(
                CommunityAnonymousAlias.post_id == post_id,
                CommunityAnonymousAlias.user_id == user_id,
            )
        )
        if existing is not None:
            return existing
        for _ in range(3):
            next_ordinal = (
                db.scalar(
                    select(
                        func.coalesce(func.max(CommunityAnonymousAlias.ordinal), 0)
                    ).where(CommunityAnonymousAlias.post_id == post_id)
                )
                or 0
            ) + 1
            savepoint = db.begin_nested()
            try:
                db.add(
                    CommunityAnonymousAlias(
                        id=uuid4(),
                        post_id=post_id,
                        user_id=user_id,
                        ordinal=next_ordinal,
                    )
                )
                savepoint.commit()
                return next_ordinal
            except IntegrityError:
                # 같은 순간에 다른 사람이 그 번호를 가져갔다. 다시 센다.
                savepoint.rollback()
                already = db.scalar(
                    select(CommunityAnonymousAlias.ordinal).where(
                        CommunityAnonymousAlias.post_id == post_id,
                        CommunityAnonymousAlias.user_id == user_id,
                    )
                )
                if already is not None:
                    return already
        raise RuntimeError("could not allocate an anonymous alias")

    def list_comments(
        self,
        *,
        post_id: UUID,
        viewer_id: UUID | None = None,
        cursor: str | None = None,
        limit: int | None = None,
    ) -> Page:
        size = _clamp_limit(limit)
        with self._session_factory() as db:
            # 글이 없거나 안 보이면 댓글도 없는 것으로 본다.
            post_row = self._load_post_row(db, post_id, viewer_id=viewer_id)
            query = (
                select(CommunityComment, User)
                .join(User, User.id == CommunityComment.author_id)
                .where(
                    CommunityComment.post_id == post_id,
                    CommunityComment.status == ContentStatus.VISIBLE,
                )
            )
            blocked = self._blocked_ids_subquery(viewer_id)
            if blocked is not None:
                query = query.where(_not_blocked(CommunityComment, blocked))
            if cursor is not None:
                stamp, row_id = decode_cursor(cursor)
                # 댓글은 오래된 순이라 부등호 방향이 글 목록과 반대다.
                query = query.where(
                    or_(
                        CommunityComment.created_at > stamp,
                        (CommunityComment.created_at == stamp)
                        & (CommunityComment.id > row_id),
                    )
                )
            rows = db.execute(
                query.order_by(
                    CommunityComment.created_at, CommunityComment.id
                ).limit(size + 1)
            ).all()
            has_more = len(rows) > size
            rows = rows[:size]
            aliases = self._alias_map(db, post_id)
            items = [
                self._comment_from_row(
                    row, viewer_id=viewer_id, post=post_row[0], aliases=aliases
                )
                for row in rows
            ]
            next_cursor = (
                encode_cursor(rows[-1][0].created_at, rows[-1][0].id)
                if has_more and rows
                else None
            )
            return Page(items=items, next_cursor=next_cursor)

    def create_comment(
        self,
        *,
        post_id: UUID,
        author_id: UUID,
        body: str,
        anonymous: bool = False,
    ) -> Comment:
        with self._session_factory.begin() as db:
            post = db.get(CommunityPost, post_id)
            if post is None or post.status != ContentStatus.VISIBLE:
                raise PostNotFound(post_id)
            comment = CommunityComment(
                id=uuid4(),
                post_id=post_id,
                author_id=author_id,
                body=body,
                anonymous=anonymous,
            )
            db.add(comment)
            post.comment_count = CommunityPost.comment_count + 1
            # 글쓴이 표시를 받는 사람은 번호가 필요 없다.
            needs_alias = anonymous and not (
                post.anonymous and author_id == post.author_id
            )
            if needs_alias:
                self._ensure_alias(db, post_id=post_id, user_id=author_id)
            db.flush()
            db.refresh(comment)
            author = db.get(User, author_id)
            return self._comment_from_row(
                (comment, author),
                viewer_id=author_id,
                post=post,
                aliases=self._alias_map(db, post_id),
            )

    def update_comment(self, *, comment_id: UUID, author_id: UUID, body: str) -> Comment:
        with self._session_factory.begin() as db:
            comment = db.get(CommunityComment, comment_id)
            if comment is None or comment.status != ContentStatus.VISIBLE:
                raise CommentNotFound(comment_id)
            if comment.author_id != author_id:
                raise NotAuthor(comment_id)
            comment.body = body
            comment.updated_at = func.now()
            db.flush()
            db.refresh(comment)
            author = db.get(User, author_id)
            post = db.get(CommunityPost, comment.post_id)
            return self._comment_from_row(
                (comment, author),
                viewer_id=author_id,
                post=post,
                aliases=self._alias_map(db, comment.post_id),
            )

    def delete_comment(self, *, comment_id: UUID, author_id: UUID) -> None:
        with self._session_factory.begin() as db:
            comment = db.get(CommunityComment, comment_id)
            if comment is None or comment.status == ContentStatus.DELETED:
                raise CommentNotFound(comment_id)
            if comment.author_id != author_id:
                raise NotAuthor(comment_id)
            comment.status = ContentStatus.DELETED
            comment.updated_at = func.now()
            post = db.get(CommunityPost, comment.post_id)
            if post is not None:
                post.comment_count = func.greatest(CommunityPost.comment_count - 1, 0)

    # ---- 신고 ----

    def create_report(
        self,
        *,
        reporter_id: UUID,
        target_type: ReportTargetType,
        target_id: UUID,
        reason: ReportReason,
        detail: str | None,
    ) -> None:
        with self._session_factory.begin() as db:
            if target_type == ReportTargetType.POST:
                target = db.get(CommunityPost, target_id)
            else:
                target = db.get(CommunityComment, target_id)
            if target is None or target.status == ContentStatus.DELETED:
                raise PostNotFound(target_id)
            if target.author_id == reporter_id:
                # 자기 글 신고는 받을 이유가 없다.
                raise NotAuthor(target_id)
            already = db.scalar(
                select(func.count())
                .select_from(CommunityReport)
                .where(
                    CommunityReport.reporter_id == reporter_id,
                    CommunityReport.target_type == target_type,
                    CommunityReport.target_id == target_id,
                )
            )
            if already:
                raise DuplicateReport(target_id)
            db.add(
                CommunityReport(
                    id=uuid4(),
                    reporter_id=reporter_id,
                    target_type=target_type,
                    target_id=target_id,
                    reason=reason,
                    detail=detail,
                    status=ReportStatus.PENDING,
                )
            )
            try:
                db.flush()
            except IntegrityError as exc:
                # 같은 순간에 두 번 눌린 경우. UNIQUE 제약이 마지막 방어선이다.
                raise DuplicateReport(target_id) from exc

    # ---- 차단 ----

    def list_blocks(self, blocker_id: UUID) -> list[Author]:
        with self._session_factory() as db:
            rows = db.execute(
                select(User)
                .join(CommunityBlock, CommunityBlock.blocked_id == User.id)
                .where(CommunityBlock.blocker_id == blocker_id)
                .order_by(CommunityBlock.created_at.desc())
            ).all()
            return [Author(id=row[0].id, nickname=row[0].nickname) for row in rows]

    def block_user(self, *, blocker_id: UUID, blocked_id: UUID) -> None:
        if blocker_id == blocked_id:
            raise NotAuthor(blocked_id)
        with self._session_factory.begin() as db:
            if db.get(User, blocked_id) is None:
                raise PostNotFound(blocked_id)
            db.execute(
                insert(CommunityBlock)
                .values(id=uuid4(), blocker_id=blocker_id, blocked_id=blocked_id)
                .on_conflict_do_nothing(constraint="uq_community_blocks_pair")
            )

    def unblock_user(self, *, blocker_id: UUID, blocked_id: UUID) -> None:
        with self._session_factory.begin() as db:
            db.execute(
                delete(CommunityBlock).where(
                    CommunityBlock.blocker_id == blocker_id,
                    CommunityBlock.blocked_id == blocked_id,
                )
            )
