"""커뮤니티 게시판 API.

읽기는 로그인 없이 열려 있다(`viewer` 의존성). 가입 전에 무슨 이야기가 오가는지
보이지 않으면 가입할 이유도 없다. 쓰기·좋아요·신고·차단은 로그인해야 한다(`author`).

익명 독자에게는 `mine`·`liked_by_me` 가 항상 false 이고 차단 필터도 적용되지 않는다 —
누구인지 모르니 걸러낼 기준이 없다.

신고와 차단을 v1 에 넣은 이유는 나중에 앱(iOS)에 붙일 때 UGC 심사 요건이라서다.
그때 급히 얹으면 데이터 모델을 뒤집어야 한다.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from starlette.concurrency import run_in_threadpool

from acting_api.db.community_store import (
    CategoryNotFound,
    CommentNotFound,
    DuplicateReport,
    NotAuthor,
    PostNotFound,
)
from acting_api.db.models import ReportReason, ReportTargetType

TITLE_MAX_LENGTH = 100
BODY_MAX_LENGTH = 5000
COMMENT_MAX_LENGTH = 1000
REPORT_DETAIL_MAX_LENGTH = 500

ReportReasonLiteral = Literal["spam", "abuse", "sexual", "privacy", "other"]
ReportTargetLiteral = Literal["post", "comment"]


class _StrictResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CategoryPayload(_StrictResponse):
    slug: str
    name: str
    description: str | None


class CategoryListResponse(_StrictResponse):
    categories: list[CategoryPayload]


class AuthorPayload(_StrictResponse):
    """익명이면 `id`·`nickname` 이 비고 `alias` 만 온다.

    익명 글에 실제 user id 를 실어 보내면 화면에 "익명" 이라 적혀 있어도 클라이언트가
    같은 id 로 다른 글과 묶는다. 그래서 아예 담지 않는다.
    """

    id: UUID | None
    # 닉네임을 아직 정하지 않은 계정이 있다. 화면에서 대체 표기를 고르도록 null 로 준다.
    nickname: str | None
    # "익명" · "익명2" · "글쓴이". 실명 글에서는 null.
    alias: str | None


class PostPayload(_StrictResponse):
    id: UUID
    anonymous: bool
    category_slug: str
    category_name: str
    author: AuthorPayload
    title: str
    body: str
    like_count: int
    comment_count: int
    view_count: int
    liked_by_me: bool
    mine: bool
    created_at: datetime
    updated_at: datetime


class PostListResponse(_StrictResponse):
    posts: list[PostPayload]
    next_cursor: str | None


class CommentPayload(_StrictResponse):
    id: UUID
    post_id: UUID
    anonymous: bool
    author: AuthorPayload
    body: str
    mine: bool
    created_at: datetime
    updated_at: datetime


class CommentListResponse(_StrictResponse):
    comments: list[CommentPayload]
    next_cursor: str | None


class LikeResponse(_StrictResponse):
    like_count: int
    liked_by_me: bool


class BlockPayload(_StrictResponse):
    user_id: UUID
    nickname: str | None


class BlockListResponse(_StrictResponse):
    blocks: list[BlockPayload]


def _trimmed(field_name: str, max_length: int):
    def _validate(value: str) -> str:
        collapsed = value.strip()
        if not collapsed:
            raise ValueError(f"{field_name} must not be blank")
        return collapsed[:max_length]

    return _validate


class PostWriteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    category_slug: str = Field(min_length=1)
    title: str = Field(min_length=1, max_length=TITLE_MAX_LENGTH)
    body: str = Field(min_length=1, max_length=BODY_MAX_LENGTH)
    # 올린 뒤에는 못 바꾼다(PostUpdateRequest 에 없다) — 뒤집으면 이미 읽힌 글의
    # 신원이 소급해서 드러난다.
    anonymous: bool = False

    _normalize_title = field_validator("title")(_trimmed("title", TITLE_MAX_LENGTH))
    _normalize_body = field_validator("body")(_trimmed("body", BODY_MAX_LENGTH))


class PostUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=TITLE_MAX_LENGTH)
    body: str = Field(min_length=1, max_length=BODY_MAX_LENGTH)

    _normalize_title = field_validator("title")(_trimmed("title", TITLE_MAX_LENGTH))
    _normalize_body = field_validator("body")(_trimmed("body", BODY_MAX_LENGTH))


class CommentWriteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    body: str = Field(min_length=1, max_length=COMMENT_MAX_LENGTH)
    anonymous: bool = False

    _normalize_body = field_validator("body")(_trimmed("body", COMMENT_MAX_LENGTH))


class ReportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    target_type: ReportTargetLiteral
    target_id: UUID
    reason: ReportReasonLiteral
    detail: str | None = Field(default=None, max_length=REPORT_DETAIL_MAX_LENGTH)


class BlockRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    user_id: UUID


def _viewer_id(user):
    """익명 독자는 None. 차단 필터와 `mine` 판정이 이 값으로 갈린다."""
    return user.id if user is not None else None


def _author_payload(author) -> AuthorPayload:
    return AuthorPayload(id=author.id, nickname=author.nickname, alias=author.alias)


def _post_payload(post) -> PostPayload:
    return PostPayload(
        id=post.id,
        anonymous=post.author.id is None,
        category_slug=post.category_slug,
        category_name=post.category_name,
        author=_author_payload(post.author),
        title=post.title,
        body=post.body,
        like_count=post.like_count,
        comment_count=post.comment_count,
        view_count=post.view_count,
        liked_by_me=post.liked_by_me,
        mine=post.mine,
        created_at=post.created_at,
        updated_at=post.updated_at,
    )


def _comment_payload(comment) -> CommentPayload:
    return CommentPayload(
        id=comment.id,
        post_id=comment.post_id,
        anonymous=comment.author.id is None,
        author=_author_payload(comment.author),
        body=comment.body,
        mine=comment.mine,
        created_at=comment.created_at,
        updated_at=comment.updated_at,
    )


def build_router(*, community_store, viewer, author) -> APIRouter:
    """`viewer` 는 익명을 허용하는 의존성(None 가능), `author` 는 로그인 필수다."""
    router = APIRouter(prefix="/v2/community", tags=["v2-community"])

    @router.get(
        "/categories",
        responses={status.HTTP_200_OK: {"model": CategoryListResponse}},
    )
    async def list_categories(user=Depends(viewer)) -> CategoryListResponse:
        categories = await run_in_threadpool(community_store.list_categories)
        return CategoryListResponse(
            categories=[
                CategoryPayload(
                    slug=item.slug, name=item.name, description=item.description
                )
                for item in categories
            ]
        )

    @router.get("/posts", responses={status.HTTP_200_OK: {"model": PostListResponse}})
    async def list_posts(
        category: str | None = Query(default=None),
        cursor: str | None = Query(default=None),
        limit: int | None = Query(default=None, ge=1, le=50),
        user=Depends(viewer),
    ) -> PostListResponse:
        try:
            page = await run_in_threadpool(
                lambda: community_store.list_posts(
                    viewer_id=_viewer_id(user),
                    category_slug=category,
                    cursor=cursor,
                    limit=limit,
                )
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="invalid_cursor") from exc
        return PostListResponse(
            posts=[_post_payload(item) for item in page.items],
            next_cursor=page.next_cursor,
        )

    @router.post(
        "/posts",
        status_code=status.HTTP_201_CREATED,
        responses={status.HTTP_201_CREATED: {"model": PostPayload}},
    )
    async def create_post(
        request: PostWriteRequest, user=Depends(author)
    ) -> PostPayload:
        try:
            post = await run_in_threadpool(
                lambda: community_store.create_post(
                    author_id=user.id,
                    category_slug=request.category_slug,
                    title=request.title,
                    body=request.body,
                    anonymous=request.anonymous,
                )
            )
        except CategoryNotFound as exc:
            raise HTTPException(status_code=404, detail="category_not_found") from exc
        return _post_payload(post)

    @router.get(
        "/posts/{post_id}", responses={status.HTTP_200_OK: {"model": PostPayload}}
    )
    async def get_post(post_id: UUID, user=Depends(viewer)) -> PostPayload:
        try:
            post = await run_in_threadpool(
                lambda: community_store.get_post(post_id, viewer_id=_viewer_id(user))
            )
        except PostNotFound as exc:
            raise HTTPException(status_code=404, detail="post_not_found") from exc
        # 조회수는 본 뒤에 올린다 — 못 본 글이 세어지지 않도록.
        if not post.mine:
            await run_in_threadpool(community_store.increment_view_count, post_id)
        return _post_payload(post)

    @router.patch(
        "/posts/{post_id}", responses={status.HTTP_200_OK: {"model": PostPayload}}
    )
    async def update_post(
        post_id: UUID, request: PostUpdateRequest, user=Depends(author)
    ) -> PostPayload:
        try:
            post = await run_in_threadpool(
                lambda: community_store.update_post(
                    post_id=post_id,
                    author_id=user.id,
                    title=request.title,
                    body=request.body,
                )
            )
        except PostNotFound as exc:
            raise HTTPException(status_code=404, detail="post_not_found") from exc
        except NotAuthor as exc:
            raise HTTPException(status_code=403, detail="not_author") from exc
        return _post_payload(post)

    @router.delete("/posts/{post_id}", status_code=status.HTTP_204_NO_CONTENT)
    async def delete_post(post_id: UUID, user=Depends(author)) -> Response:
        try:
            await run_in_threadpool(
                lambda: community_store.delete_post(post_id=post_id, author_id=user.id)
            )
        except PostNotFound as exc:
            raise HTTPException(status_code=404, detail="post_not_found") from exc
        except NotAuthor as exc:
            raise HTTPException(status_code=403, detail="not_author") from exc
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @router.post(
        "/posts/{post_id}/likes",
        responses={status.HTTP_200_OK: {"model": LikeResponse}},
    )
    async def like_post(post_id: UUID, user=Depends(author)) -> LikeResponse:
        try:
            like_count = await run_in_threadpool(
                lambda: community_store.like_post(post_id=post_id, user_id=user.id)
            )
        except PostNotFound as exc:
            raise HTTPException(status_code=404, detail="post_not_found") from exc
        return LikeResponse(like_count=like_count, liked_by_me=True)

    @router.delete(
        "/posts/{post_id}/likes",
        responses={status.HTTP_200_OK: {"model": LikeResponse}},
    )
    async def unlike_post(
        post_id: UUID, user=Depends(author)
    ) -> LikeResponse:
        try:
            like_count = await run_in_threadpool(
                lambda: community_store.unlike_post(post_id=post_id, user_id=user.id)
            )
        except PostNotFound as exc:
            raise HTTPException(status_code=404, detail="post_not_found") from exc
        return LikeResponse(like_count=like_count, liked_by_me=False)

    @router.get(
        "/posts/{post_id}/comments",
        responses={status.HTTP_200_OK: {"model": CommentListResponse}},
    )
    async def list_comments(
        post_id: UUID,
        cursor: str | None = Query(default=None),
        limit: int | None = Query(default=None, ge=1, le=50),
        user=Depends(viewer),
    ) -> CommentListResponse:
        try:
            page = await run_in_threadpool(
                lambda: community_store.list_comments(
                    post_id=post_id,
                    viewer_id=_viewer_id(user),
                    cursor=cursor,
                    limit=limit,
                )
            )
        except PostNotFound as exc:
            raise HTTPException(status_code=404, detail="post_not_found") from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="invalid_cursor") from exc
        return CommentListResponse(
            comments=[_comment_payload(item) for item in page.items],
            next_cursor=page.next_cursor,
        )

    @router.post(
        "/posts/{post_id}/comments",
        status_code=status.HTTP_201_CREATED,
        responses={status.HTTP_201_CREATED: {"model": CommentPayload}},
    )
    async def create_comment(
        post_id: UUID, request: CommentWriteRequest, user=Depends(author)
    ) -> CommentPayload:
        try:
            comment = await run_in_threadpool(
                lambda: community_store.create_comment(
                    post_id=post_id,
                    author_id=user.id,
                    body=request.body,
                    anonymous=request.anonymous,
                )
            )
        except PostNotFound as exc:
            raise HTTPException(status_code=404, detail="post_not_found") from exc
        return _comment_payload(comment)

    @router.patch(
        "/comments/{comment_id}",
        responses={status.HTTP_200_OK: {"model": CommentPayload}},
    )
    async def update_comment(
        comment_id: UUID, request: CommentWriteRequest, user=Depends(author)
    ) -> CommentPayload:
        try:
            comment = await run_in_threadpool(
                lambda: community_store.update_comment(
                    comment_id=comment_id, author_id=user.id, body=request.body
                )
            )
        except CommentNotFound as exc:
            raise HTTPException(status_code=404, detail="comment_not_found") from exc
        except NotAuthor as exc:
            raise HTTPException(status_code=403, detail="not_author") from exc
        return _comment_payload(comment)

    @router.delete("/comments/{comment_id}", status_code=status.HTTP_204_NO_CONTENT)
    async def delete_comment(
        comment_id: UUID, user=Depends(author)
    ) -> Response:
        try:
            await run_in_threadpool(
                lambda: community_store.delete_comment(
                    comment_id=comment_id, author_id=user.id
                )
            )
        except CommentNotFound as exc:
            raise HTTPException(status_code=404, detail="comment_not_found") from exc
        except NotAuthor as exc:
            raise HTTPException(status_code=403, detail="not_author") from exc
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @router.post("/reports", status_code=status.HTTP_204_NO_CONTENT)
    async def create_report(
        request: ReportRequest, user=Depends(author)
    ) -> Response:
        try:
            await run_in_threadpool(
                lambda: community_store.create_report(
                    reporter_id=user.id,
                    target_type=ReportTargetType(request.target_type),
                    target_id=request.target_id,
                    reason=ReportReason(request.reason),
                    detail=request.detail,
                )
            )
        except PostNotFound as exc:
            raise HTTPException(status_code=404, detail="target_not_found") from exc
        except NotAuthor as exc:
            raise HTTPException(status_code=400, detail="cannot_report_own") from exc
        except DuplicateReport as exc:
            raise HTTPException(status_code=409, detail="already_reported") from exc
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @router.get(
        "/blocks", responses={status.HTTP_200_OK: {"model": BlockListResponse}}
    )
    async def list_blocks(user=Depends(author)) -> BlockListResponse:
        blocks = await run_in_threadpool(community_store.list_blocks, user.id)
        return BlockListResponse(
            blocks=[
                BlockPayload(user_id=item.id, nickname=item.nickname) for item in blocks
            ]
        )

    @router.post("/blocks", status_code=status.HTTP_204_NO_CONTENT)
    async def block_user(
        request: BlockRequest, user=Depends(author)
    ) -> Response:
        try:
            await run_in_threadpool(
                lambda: community_store.block_user(
                    blocker_id=user.id, blocked_id=request.user_id
                )
            )
        except NotAuthor as exc:
            raise HTTPException(status_code=400, detail="cannot_block_self") from exc
        except PostNotFound as exc:
            raise HTTPException(status_code=404, detail="user_not_found") from exc
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @router.delete("/blocks/{blocked_id}", status_code=status.HTTP_204_NO_CONTENT)
    async def unblock_user(
        blocked_id: UUID, user=Depends(author)
    ) -> Response:
        await run_in_threadpool(
            lambda: community_store.unblock_user(
                blocker_id=user.id, blocked_id=blocked_id
            )
        )
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    return router
