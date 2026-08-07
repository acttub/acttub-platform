"""커뮤니티 · 프로필 · admissions · admin 시나리오.

`tests/test_response_contracts.py` 의 전 플로우 대본이 41개 operation 중 20개만
실행하기 때문에 나머지를 여기서 덮는다. 응답 스키마 선언만 맞고 실제 조회 필터·
커서·익명 별칭·권한이 틀린 구현을 걸러내는 것이 목적이다.
"""

from __future__ import annotations

from contract_harness import config as cfg
from contract_harness.scenarios.support import (
    create_analyzed_session,
    grant_all_consents,
    login,
    require,
)
from contract_harness.stubs import S3_FIXTURE

USER1, USER2, USER3, USER4 = cfg.SEED_USER_IDS


def _directions(values: list[str]) -> str:
    if len(values) < 2:
        return "single"
    if all(left > right for left, right in zip(values, values[1:])):
        return "desc"
    if all(left < right for left, right in zip(values, values[1:])):
        return "asc"
    return "mixed"


def community(ctx) -> None:
    one = ctx.auth(USER1)
    two = ctx.auth(USER2)

    ctx.call("categories", "get", "/v2/community/categories")

    created = ctx.call(
        "post-create",
        "post",
        "/v2/community/posts",
        json={
            "category_slug": "free",
            "title": "  새 글 제목  ",
            "body": "  본문은 앞뒤 공백이 잘린다  ",
            "anonymous": False,
        },
        headers=one,
    )
    require(created.status == 201, f"글 생성 실패 {created.status} {created.body!r}")
    post_id = created.parsed["id"]
    ctx.register(post_id, "post")

    # 조회수는 **본 뒤에** 올린다 — 첫 조회 응답은 증가 전 값이어야 한다.
    first_view = ctx.call(
        "post-get-1",
        "get",
        "/v2/community/posts/{post_id}",
        path_params={"post_id": post_id},
        headers=two,
    )
    second_view = ctx.call(
        "post-get-2",
        "get",
        "/v2/community/posts/{post_id}",
        path_params={"post_id": post_id},
        headers=two,
    )
    ctx.note(
        "view-count",
        {
            "first": first_view.parsed["view_count"],
            "second": second_view.parsed["view_count"],
        },
    )

    ctx.call(
        "post-patch",
        "patch",
        "/v2/community/posts/{post_id}",
        path_params={"post_id": post_id},
        json={"title": "고친 제목", "body": "고친 본문"},
        headers=one,
    )

    like_once = ctx.call(
        "like",
        "post",
        "/v2/community/posts/{post_id}/likes",
        path_params={"post_id": post_id},
        headers=two,
    )
    like_twice = ctx.call(
        "like-again",
        "post",
        "/v2/community/posts/{post_id}/likes",
        path_params={"post_id": post_id},
        headers=two,
    )
    unliked = ctx.call(
        "unlike",
        "delete",
        "/v2/community/posts/{post_id}/likes",
        path_params={"post_id": post_id},
        headers=two,
    )
    ctx.note(
        "like-counts",
        {
            "once": like_once.parsed["like_count"],
            "twice": like_twice.parsed["like_count"],
            "unliked": unliked.parsed["like_count"],
        },
    )

    named_comment = ctx.call(
        "comment-create",
        "post",
        "/v2/community/posts/{post_id}/comments",
        path_params={"post_id": post_id},
        json={"body": "  실명 댓글  ", "anonymous": False},
        headers=one,
    )
    require(named_comment.status == 201, f"댓글 생성 실패 {named_comment.status}")
    ctx.register(named_comment.parsed["id"], "comment")
    anon_comment = ctx.call(
        "comment-create-anon",
        "post",
        "/v2/community/posts/{post_id}/comments",
        path_params={"post_id": post_id},
        json={"body": "익명 댓글", "anonymous": True},
        headers=two,
    )
    ctx.register(anon_comment.parsed["id"], "comment")

    seed_post = cfg.SEED_POST_IDS[0]
    seed_comments = ctx.call(
        "comments-seed",
        "get",
        "/v2/community/posts/{post_id}/comments",
        path_params={"post_id": seed_post},
    )
    ctx.note(
        "anonymous-aliases",
        [comment["author"]["alias"] for comment in seed_comments.parsed["comments"]],
    )

    ctx.call(
        "comment-patch",
        "patch",
        "/v2/community/comments/{comment_id}",
        path_params={"comment_id": named_comment.parsed["id"]},
        json={"body": "고친 댓글", "anonymous": False},
        headers=one,
    )
    before_delete = ctx.call(
        "comments-before-delete",
        "get",
        "/v2/community/posts/{post_id}/comments",
        path_params={"post_id": post_id},
        headers=one,
    )
    ctx.call(
        "comment-delete",
        "delete",
        "/v2/community/comments/{comment_id}",
        path_params={"comment_id": named_comment.parsed["id"]},
        headers=one,
    )
    # 204 뒤에 관측이 없으면 아무것도 안 지우는 구현이 통과한다.
    after_delete = ctx.call(
        "comments-after-delete",
        "get",
        "/v2/community/posts/{post_id}/comments",
        path_params={"post_id": post_id},
        headers=one,
    )
    post_after_comment_delete = ctx.call(
        "post-after-comment-delete",
        "get",
        "/v2/community/posts/{post_id}",
        path_params={"post_id": post_id},
        headers=one,
    )
    ctx.note(
        "comment-delete.effect",
        {
            "before": len((before_delete.parsed or {}).get("comments", [])),
            "after": len((after_delete.parsed or {}).get("comments", [])),
            "gone": all(
                item["id"] != named_comment.parsed["id"]
                for item in (after_delete.parsed or {}).get("comments", [])
            ),
            "comment_count": post_after_comment_delete.parsed["comment_count"],
        },
    )
    # 같은 댓글을 다시 지우면 이미 없는 것으로 보여야 한다.
    ctx.call(
        "comment-delete-again",
        "delete",
        "/v2/community/comments/{comment_id}",
        path_params={"comment_id": named_comment.parsed["id"]},
        headers=one,
    )

    ctx.call(
        "report",
        "post",
        "/v2/community/reports",
        json={
            "target_type": "post",
            "target_id": post_id,
            "reason": "spam",
            "detail": "광고 같아요",
        },
        headers=two,
    )
    ctx.call(
        "report-duplicate",
        "post",
        "/v2/community/reports",
        json={
            "target_type": "post",
            "target_id": post_id,
            "reason": "spam",
            "detail": "광고 같아요",
        },
        headers=two,
    )

    ctx.call("blocks-before", "get", "/v2/community/blocks", headers=one)
    ctx.call(
        "block",
        "post",
        "/v2/community/blocks",
        json={"user_id": USER2},
        headers=one,
    )
    ctx.call("blocks-after", "get", "/v2/community/blocks", headers=one)
    blocked_view = ctx.call(
        "posts-blocked-view",
        "get",
        "/v2/community/posts",
        params={"limit": 50},
        headers=one,
    )
    ctx.note(
        "blocked-filter",
        {
            "visible_posts": [item["id"] for item in blocked_view.parsed["posts"]],
            "anonymous_kept": any(
                item["anonymous"] for item in blocked_view.parsed["posts"]
            ),
        },
    )
    ctx.call(
        "unblock",
        "delete",
        "/v2/community/blocks/{blocked_id}",
        path_params={"blocked_id": USER2},
        headers=one,
    )
    # unblock 이 실제로 행을 지웠는지: 차단 목록이 비고 가려졌던 글이 돌아온다.
    unblocked_list = ctx.call(
        "blocks-after-unblock", "get", "/v2/community/blocks", headers=one
    )
    restored = ctx.call(
        "posts-after-unblock",
        "get",
        "/v2/community/posts",
        params={"limit": 50},
        headers=one,
    )
    ctx.note(
        "unblock.effect",
        {
            "block_list_empty": (unblocked_list.parsed or {}).get("blocks") == [],
            "visible_posts": [
                item["id"] for item in (restored.parsed or {}).get("posts", [])
            ],
            "restored_count": len((restored.parsed or {}).get("posts", []))
            - len((blocked_view.parsed or {}).get("posts", [])),
        },
    )

    deleted_post = ctx.call(
        "post-delete",
        "delete",
        "/v2/community/posts/{post_id}",
        path_params={"post_id": post_id},
        headers=one,
    )
    require(deleted_post.status == 204, f"글 삭제가 204 가 아니다: {deleted_post.status}")
    ctx.call(
        "post-after-delete",
        "get",
        "/v2/community/posts/{post_id}",
        path_params={"post_id": post_id},
        headers=one,
    )
    listed_after_delete = ctx.call(
        "posts-after-delete",
        "get",
        "/v2/community/posts",
        params={"limit": 50},
        headers=one,
    )
    ctx.note(
        "post-delete.effect",
        {
            "gone_from_list": all(
                item["id"] != post_id
                for item in (listed_after_delete.parsed or {}).get("posts", [])
            ),
            "list_length": len((listed_after_delete.parsed or {}).get("posts", [])),
        },
    )
    ctx.call(
        "comments-after-post-delete",
        "get",
        "/v2/community/posts/{post_id}/comments",
        path_params={"post_id": post_id},
        headers=one,
    )


def cursor_traversal(ctx) -> None:
    """cursor 는 교차 비교하지 않는다. 대신 **순회 결과 시퀀스**를 비교한다."""
    one = ctx.auth(USER1)
    for index in range(2):
        created = ctx.call(
            f"extra-post-{index}",
            "post",
            "/v2/community/posts",
            json={
                "category_slug": "free",
                "title": f"런타임 글 {index}",
                "body": "커서가 런타임 ID 를 품게 만든다",
                "anonymous": False,
            },
            headers=one,
        )
        require(created.status == 201, "런타임 글 생성 실패")
        ctx.register(created.parsed["id"], "post")

    seen: list[str] = []
    timestamps: list[str] = []
    cursor = None
    for page in range(12):
        params = {"limit": 5}
        if cursor is not None:
            params["cursor"] = cursor
        step = ctx.call(
            f"posts-page-{page}",
            "get",
            "/v2/community/posts",
            params=params,
        )
        require(step.status == 200, f"목록 실패 {step.status} {step.body!r}")
        body = step.parsed
        seen.extend(item["id"] for item in body["posts"])
        timestamps.extend(item["created_at"] for item in body["posts"])
        cursor = body["next_cursor"]
        if cursor is None:
            break
    ctx.note(
        "posts-traversal",
        {
            "sequence": [ctx.symbols.get(value) or value for value in seen],
            "duplicates": sorted({value for value in seen if seen.count(value) > 1}),
            "count": len(seen),
            "direction": _directions(timestamps),
            "pages": page + 1,
            "terminated": cursor is None,
        },
    )

    comment_seen: list[str] = []
    comment_stamps: list[str] = []
    cursor = None
    seed_post = cfg.SEED_POST_IDS[0]
    for page in range(12):
        params = {"limit": 3}
        if cursor is not None:
            params["cursor"] = cursor
        step = ctx.call(
            f"comments-page-{page}",
            "get",
            "/v2/community/posts/{post_id}/comments",
            path_params={"post_id": seed_post},
            params=params,
        )
        require(step.status == 200, f"댓글 목록 실패 {step.status}")
        body = step.parsed
        comment_seen.extend(item["id"] for item in body["comments"])
        comment_stamps.extend(item["created_at"] for item in body["comments"])
        cursor = body["next_cursor"]
        if cursor is None:
            break
    ctx.note(
        "comments-traversal",
        {
            "sequence": [ctx.symbols.get(value) or value for value in comment_seen],
            "duplicates": sorted(
                {value for value in comment_seen if comment_seen.count(value) > 1}
            ),
            "count": len(comment_seen),
            "direction": _directions(comment_stamps),
            "terminated": cursor is None,
        },
    )
    ctx.call("invalid-cursor", "get", "/v2/community/posts", params={"cursor": "!!"})


def profile(ctx) -> None:
    headers = ctx.auth(USER1)
    ctx.call("me", "get", "/v2/me", headers=headers)
    ctx.call(
        "me-patch",
        "patch",
        "/v2/me",
        json={"nickname": "  두   칸   띄운   이름  "},
        headers=headers,
    )
    ctx.call("me-after", "get", "/v2/me", headers=headers)
    ctx.call(
        "me-patch-blank",
        "patch",
        "/v2/me",
        json={"nickname": "   "},
        headers=headers,
    )
    ctx.call(
        "me-patch-too-long",
        "patch",
        "/v2/me",
        json={"nickname": "가" * 21},
        headers=headers,
    )


def admissions(ctx) -> None:
    ctx.call("admissions", "get", "/v2/admissions")
    ctx.call(
        "admissions-one",
        "get",
        "/v2/admissions/{university_id}",
        path_params={"university_id": "cau"},
    )
    ctx.call(
        "admissions-missing",
        "get",
        "/v2/admissions/{university_id}",
        path_params={"university_id": "no-such-university"},
    )


def admin(ctx) -> None:
    """별도 프로파일 — `ADMIN_OPS_TOKEN` 이 있을 때만 라우터가 붙는다."""
    admin_headers = {"Authorization": f"Bearer {cfg.ADMIN_OPS_TOKEN}"}

    ctx.call("stats-unauthorized", "get", "/v2/admin/stats")
    ctx.call(
        "stats-wrong-token",
        "get",
        "/v2/admin/stats",
        headers={"Authorization": "Bearer nope"},
    )
    ctx.call("stats", "get", "/v2/admin/stats", headers=admin_headers)

    # presign fallback: 재생 URL 서명이 실패해도 대화는 보여준다.
    tokens = login(ctx, "login", "harness-token-new-actor")
    user_headers = {"Authorization": f"Bearer {tokens['access_token']}"}
    grant_all_consents(ctx, "admin", user_headers)
    session_id = create_analyzed_session(
        ctx,
        "admin",
        user_headers,
        tag="admin",
        body_overrides={},
    )
    started = ctx.call(
        "coach-start",
        "post",
        "/v2/coach/start",
        json={"practice_session_id": session_id, "restart": True},
        headers={**user_headers, "X-Request-Id": ctx.request_id("admin-coach")},
        canonical=True,
        expect_request_id=True,
    )
    require(started.status == 200, f"coach start 실패 {started.status}")
    ctx.register(started.parsed["session_id"], "coach_session")

    sessions = ctx.call(
        "sessions", "get", "/v2/admin/sessions", headers=admin_headers
    )
    require(sessions.status == 200, f"admin sessions 실패 {sessions.status}")
    ctx.note(
        "admin-sessions-shape",
        {
            "count": len(sessions.parsed["sessions"]),
            "has_video_url": [
                item["video_url"] is not None for item in sessions.parsed["sessions"]
            ],
            "playback_expires_in_sec": sessions.parsed["playback_expires_in_sec"],
        },
    )

    # presign 이 실패하는 업로드로 만든 세션은 video_url 이 null 이어야 한다.
    fallback_intent = ctx.call(
        "fallback.intent",
        "post",
        "/v2/uploads/intents",
        json={
            "mime_type": S3_FIXTURE["mime_types"]["playback_presign_failure"],
            "size_bytes": 4096,
            "duration_ms": 1500,
        },
        headers=user_headers,
    )
    require(fallback_intent.status == 201, "fallback intent 실패")
    ctx.register(fallback_intent.parsed["intent_id"], "upload_intent")
    ctx.call(
        "fallback.complete",
        "post",
        "/v2/uploads/intents/{intent_id}/complete",
        path_params={"intent_id": fallback_intent.parsed["intent_id"]},
        headers=user_headers,
    )
    fallback_session = ctx.call(
        "fallback.session",
        "post",
        "/v2/practice-sessions",
        json={
            "upload_intent_id": fallback_intent.parsed["intent_id"],
            "situation": "presign 실패 확인",
            "character_context": "배우",
            "goal": "확인",
            "blockage_kind": "그 외",
            "sub_branch": "그 외",
            "blockage_detail": None,
        },
        headers={**user_headers, "X-Request-Id": ctx.request_id("fallback")},
        expect_request_id=True,
    )
    require(fallback_session.status == 202, "fallback 세션 생성 실패")
    ctx.register(fallback_session.parsed["session_id"], "practice_session")
    ctx.control("fallback.worker", "run-worker-once")
    fallback_start = ctx.call(
        "fallback.coach-start",
        "post",
        "/v2/coach/start",
        json={
            "practice_session_id": fallback_session.parsed["session_id"],
            "restart": True,
        },
        headers={**user_headers, "X-Request-Id": ctx.request_id("fallback-coach")},
        canonical=True,
        expect_request_id=True,
    )
    require(fallback_start.status == 200, f"fallback coach start 실패 {fallback_start.status}")
    ctx.register(fallback_start.parsed["session_id"], "coach_session")
    with_fallback = ctx.call(
        "sessions-with-fallback",
        "get",
        "/v2/admin/sessions",
        headers=admin_headers,
    )
    ctx.note(
        "admin-presign-fallback",
        {
            "video_urls_null": [
                item["video_url"] is None for item in with_fallback.parsed["sessions"]
            ]
        },
    )
