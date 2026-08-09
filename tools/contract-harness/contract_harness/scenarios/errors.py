"""오류 계약 실행 manifest · 상태코드 모음 · storage 미설정 프로파일.

각 케이스의 step id 는 `manifest.py:CASES` 가 가리키는 것과 정확히 같아야 한다.
전체 실행이 끝나면 runner 가 (scenario, step) 존재와 status/detail 을 대조한다.
"""

from __future__ import annotations

from contract_harness import config as cfg
from contract_harness.scenarios.support import (
    create_upload,
    grant_all_consents,
    login,
    require,
    session_body,
)
from contract_harness.seed import deactivated_refresh_token, suspended_refresh_token
from contract_harness.stubs import S3_FIXTURE

MISSING = "00000000-0000-4000-8000-000000009001"
MISSING_2 = "00000000-0000-4000-8000-000000009002"
COMPLETE_MARKER = "[[coach:complete]]"
BAD_REPORT_MARKER = "[[coach:complete-badreport]]"


def status_codes(ctx) -> None:
    """`tests/test_platform_v2.py` 계열 — complete 멱등 · 소유권 404."""
    tokens = login(ctx, "login", "harness-token-new-actor")
    headers = {"Authorization": f"Bearer {tokens['access_token']}"}
    grant_all_consents(ctx, "status", headers)
    other = login(ctx, "login-other", "harness-token-second-actor")
    other_headers = {"Authorization": f"Bearer {other['access_token']}"}
    grant_all_consents(ctx, "status-other", other_headers)

    intent_id = create_upload(ctx, "status", headers)
    # complete 는 멱등이다 — 두 번째도 200 finalized.
    ctx.call(
        "complete-idempotent",
        "post",
        "/v2/uploads/intents/{intent_id}/complete",
        path_params={"intent_id": intent_id},
        headers=headers,
    )

    created = ctx.call(
        "session-create",
        "post",
        "/v2/practice-sessions",
        json=session_body(intent_id),
        headers={**headers, "X-Request-Id": ctx.request_id("status-create")},
        expect_request_id=True,
    )
    require(created.status == 202, f"세션 생성 실패 {created.status} {created.body!r}")
    session_id = created.parsed["session_id"]
    ctx.register(session_id, "practice_session")
    ctx.control("status.worker", "run-worker-once")

    # 404 는 "없음" 과 "남의 리소스" 를 구분하지 않는다.
    for name, path in (
        ("detail", "/v2/practice-sessions/{session_id}"),
        ("status", "/v2/practice-sessions/{session_id}/status"),
    ):
        ctx.call(
            f"ownership.{name}",
            "get",
            path,
            path_params={"session_id": session_id},
            headers=other_headers,
        )
    ctx.call(
        "ownership.delete",
        "delete",
        "/v2/practice-sessions/{session_id}",
        path_params={"session_id": session_id},
        headers=other_headers,
    )
    ctx.call(
        "ownership.upload-complete",
        "post",
        "/v2/uploads/intents/{intent_id}/complete",
        path_params={"intent_id": intent_id},
        headers=other_headers,
    )
    ctx.call(
        "ownership.report-detail",
        "get",
        "/v2/reports/{practice_session_id}",
        path_params={"practice_session_id": session_id},
        headers=other_headers,
    )


def no_storage(ctx) -> None:
    """`s3_storage` 미주입 프로파일 — 503 storage_not_configured 세 곳."""
    tokens = login(ctx, "login", "harness-token-new-actor")
    headers = {"Authorization": f"Bearer {tokens['access_token']}"}
    grant_all_consents(ctx, "nostorage", headers)
    ctx.call(
        "uploads-intent",
        "post",
        "/v2/uploads/intents",
        json={"mime_type": "video/mp4", "size_bytes": 4096, "duration_ms": 1000},
        headers=headers,
    )
    # 404 검사가 먼저이므로 실재하는 리소스로 때려야 503 에 닿는다.
    seed_headers = ctx.auth(cfg.SEED_USER_IDS[0])
    ctx.call(
        "session-detail",
        "get",
        "/v2/practice-sessions/{session_id}",
        path_params={"session_id": cfg.SEED_PRACTICE_SESSION_ID},
        headers=seed_headers,
    )
    ctx.call(
        "report-detail",
        "get",
        "/v2/reports/{practice_session_id}",
        path_params={"practice_session_id": cfg.SEED_PRACTICE_SESSION_ID},
        headers=seed_headers,
    )


def error_manifest(ctx) -> None:
    suspended_headers = {
        "Authorization": f"Bearer {ctx.token(cfg.SEED_SUSPENDED_USER[0])}"
    }
    ctx.call("suspended.me", "get", "/v2/me", headers=suspended_headers)
    ctx.call(
        "suspended.community", "get", "/v2/community/posts", headers=suspended_headers
    )

    # 탈퇴 계정은 정지 계정과 다른 코드로 막힌다. 잔여 액세스 토큰도 통하지 않는다.
    deactivated_headers = {
        "Authorization": f"Bearer {ctx.token(cfg.SEED_DEACTIVATED_USER[0])}"
    }
    ctx.call("deactivated.me", "get", "/v2/me", headers=deactivated_headers)
    ctx.call(
        "deactivated.community",
        "get",
        "/v2/community/posts",
        headers=deactivated_headers,
    )

    ctx.call(
        "login.unsupported-provider",
        "post",
        "/v2/auth/login",
        json={"provider": "kakao", "id_token": "harness-token-new-actor"},
    )
    ctx.call(
        "login.invalid-token",
        "post",
        "/v2/auth/login",
        json={"provider": "google", "id_token": "harness-token-invalid"},
    )
    ctx.call(
        "login.unconfigured-provider",
        "post",
        "/v2/auth/login",
        json={"provider": "apple", "id_token": "harness-token-new-actor"},
    )
    ctx.call(
        "login.email-collision",
        "post",
        "/v2/auth/login",
        json={"provider": "google", "id_token": "harness-token-unverified-dup"},
    )
    ctx.call(
        "login.suspended",
        "post",
        "/v2/auth/login",
        json={"provider": "google", "id_token": "harness-token-suspended"},
    )
    ctx.call(
        "refresh.suspended",
        "post",
        "/v2/auth/refresh",
        json={"refresh_token": suspended_refresh_token()},
    )
    # 탈퇴한 뒤 같은 소셜 계정으로 돌아와도 새 계정이 생기지 않고 403 이다.
    ctx.call(
        "login.deactivated",
        "post",
        "/v2/auth/login",
        json={"provider": "google", "id_token": "harness-token-deactivated"},
    )
    ctx.call(
        "refresh.deactivated",
        "post",
        "/v2/auth/refresh",
        json={"refresh_token": deactivated_refresh_token()},
    )

    tokens = login(ctx, "login", "harness-token-new-actor")
    headers = {"Authorization": f"Bearer {tokens['access_token']}"}
    ctx.call(
        "logout.invalid",
        "post",
        "/v2/auth/logout",
        json={"refresh_token": "not.a.token"},
        headers=headers,
    )
    ctx.call(
        "consents.unknown-document",
        "post",
        "/v2/consents",
        json={"document_id": MISSING, "action": "granted"},
        headers=headers,
    )
    grant_all_consents(ctx, "manifest", headers)

    # --- uploads ---------------------------------------------------------
    ctx.call(
        "uploads.credentials-error",
        "post",
        "/v2/uploads/intents",
        json={
            "mime_type": S3_FIXTURE["mime_types"]["credentials_error"],
            "size_bytes": 4096,
            "duration_ms": 1000,
        },
        headers=headers,
    )
    ctx.call(
        "uploads.complete-missing",
        "post",
        "/v2/uploads/intents/{intent_id}/complete",
        path_params={"intent_id": MISSING},
        headers=headers,
    )
    for name, mime in (
        ("uploads.head-missing", S3_FIXTURE["mime_types"]["head_missing"]),
        ("uploads.head-size-mismatch", S3_FIXTURE["mime_types"]["head_size_mismatch"]),
    ):
        intent = ctx.call(
            f"{name}.intent",
            "post",
            "/v2/uploads/intents",
            json={"mime_type": mime, "size_bytes": 4096, "duration_ms": 1000},
            headers=headers,
        )
        require(intent.status == 201, f"{name}: intent 생성 실패 {intent.status}")
        ctx.register(intent.parsed["intent_id"], "upload_intent")
        ctx.call(
            name,
            "post",
            "/v2/uploads/intents/{intent_id}/complete",
            path_params={"intent_id": intent.parsed["intent_id"]},
            headers=headers,
        )

    # --- practice sessions ------------------------------------------------
    ctx.call(
        "practice.missing-intent",
        "post",
        "/v2/practice-sessions",
        json=session_body(MISSING),
        headers={**headers, "X-Request-Id": ctx.request_id("missing-intent")},
    )
    pending_intent = ctx.call(
        "practice.pending-intent",
        "post",
        "/v2/uploads/intents",
        json={"mime_type": "video/mp4", "size_bytes": 4096, "duration_ms": 1000},
        headers=headers,
    )
    ctx.register(pending_intent.parsed["intent_id"], "upload_intent")
    ctx.call(
        "practice.unfinalized-intent",
        "post",
        "/v2/practice-sessions",
        json=session_body(pending_intent.parsed["intent_id"]),
        headers={**headers, "X-Request-Id": ctx.request_id("unfinalized")},
    )

    intent_id = create_upload(ctx, "manifest", headers)
    fingerprint_request_id = ctx.request_id("fingerprint")
    first = ctx.call(
        "practice.fingerprint-first",
        "post",
        "/v2/practice-sessions",
        json=session_body(intent_id),
        headers={**headers, "X-Request-Id": fingerprint_request_id},
        expect_request_id=True,
    )
    require(first.status == 202, f"세션 생성 실패 {first.status} {first.body!r}")
    session_id = first.parsed["session_id"]
    ctx.register(session_id, "practice_session")
    ctx.call(
        "practice.fingerprint-mismatch",
        "post",
        "/v2/practice-sessions",
        json=session_body(intent_id, situation="다른 상황"),
        headers={**headers, "X-Request-Id": fingerprint_request_id},
    )
    ctx.call(
        "practice.status-missing",
        "get",
        "/v2/practice-sessions/{session_id}/status",
        path_params={"session_id": MISSING},
        headers=headers,
    )
    ctx.call(
        "practice.detail-missing",
        "get",
        "/v2/practice-sessions/{session_id}",
        path_params={"session_id": MISSING},
        headers=headers,
    )
    ctx.call(
        "practice.reanalyze-missing",
        "post",
        "/v2/practice-sessions/{session_id}/analyze",
        path_params={"session_id": MISSING},
        headers={**headers, "X-Request-Id": ctx.request_id("reanalyze-missing")},
    )

    # 분석이 아직 안 끝난 세션 → coach start 409
    ctx.call(
        "coach.start-analyzing",
        "post",
        "/v2/coach/start",
        json={"practice_session_id": session_id},
        headers={**headers, "X-Request-Id": ctx.request_id("coach-analyzing")},
    )
    ctx.control("manifest.worker", "run-worker-once")

    # 실패한 세션을 만들어 재분석 fingerprint 충돌을 밟는다.
    failed_intent = create_upload(ctx, "manifest-failed", headers)
    failed_request_id = ctx.request_id("failed-create")
    failed = ctx.call(
        "practice.failed-create",
        "post",
        "/v2/practice-sessions",
        json=session_body(failed_intent, situation="실패 유도 [[analyze:timeout]]"),
        headers={**headers, "X-Request-Id": failed_request_id},
        expect_request_id=True,
    )
    require(failed.status == 202, "실패 유도 세션 생성 실패")
    failed_session_id = failed.parsed["session_id"]
    ctx.register(failed_session_id, "practice_session")
    ctx.control("manifest.worker-fail", "run-worker-once")
    ctx.call(
        "practice.reanalyze-fingerprint",
        "post",
        "/v2/practice-sessions/{session_id}/analyze",
        path_params={"session_id": failed_session_id},
        headers={**headers, "X-Request-Id": failed_request_id},
    )

    # --- coach -----------------------------------------------------------
    ctx.call(
        "coach.start-missing",
        "post",
        "/v2/coach/start",
        json={"practice_session_id": MISSING},
        headers={**headers, "X-Request-Id": ctx.request_id("coach-missing")},
    )
    ctx.call(
        "coach.reply-missing",
        "post",
        "/v2/coach/reply",
        json={"session_id": MISSING_2, "text": "없는 세션"},
        headers={**headers, "X-Request-Id": ctx.request_id("coach-reply-missing")},
    )
    ctx.call(
        "coach.confirm-missing",
        "post",
        "/v2/coach/confirm",
        json={"coach_session_id": MISSING_2, "confirmed": True, "rebuttal_text": None},
        headers={**headers, "X-Request-Id": ctx.request_id("coach-confirm-missing")},
    )
    ctx.call(
        "reports.missing-session",
        "post",
        "/v2/reports",
        json={"session_id": MISSING_2},
        headers={**headers, "X-Request-Id": ctx.request_id("reports-missing")},
    )
    ctx.call(
        "reports.detail-missing",
        "get",
        "/v2/reports/{practice_session_id}",
        path_params={"practice_session_id": MISSING},
        headers=headers,
    )

    started = ctx.call(
        "coach.start",
        "post",
        "/v2/coach/start",
        json={"practice_session_id": session_id, "restart": True},
        headers={**headers, "X-Request-Id": ctx.request_id("coach-start")},
        canonical=True,
        expect_request_id=True,
    )
    require(started.status == 200, f"coach start 실패 {started.status} {started.body!r}")
    coach_session_id = started.parsed["session_id"]
    ctx.register(coach_session_id, "coach_session")

    # 노트는 배우가 두 번 이상 답한 뒤에만 만들어진다 — 502 를 보려면 답을 채워야 한다
    for idx, answer in enumerate(("상대를 붙잡고 싶었어요", "말이 안 통한다고 느꼈어요")):
        ctx.call(
            f"coach.reply-answer-{idx}",
            "post",
            "/v2/coach/reply",
            json={"session_id": coach_session_id, "text": answer},
            headers={**headers, "X-Request-Id": ctx.request_id(f"coach-reply-answer-{idx}")},
        )

    # 리포트 파싱 실패 → 502 (동적 detail 을 스텁으로 고정한다)
    ctx.call(
        "coach.reply-502",
        "post",
        "/v2/coach/reply",
        json={"session_id": coach_session_id, "text": f"끝내죠 {BAD_REPORT_MARKER}"},
        headers={**headers, "X-Request-Id": ctx.request_id("coach-reply-502")},
    )

    # restart 로 이전 세션을 닫고 닫힌 세션에 reply → 409 session is closed
    restarted = ctx.call(
        "coach.restart",
        "post",
        "/v2/coach/start",
        json={"practice_session_id": session_id, "restart": True},
        headers={**headers, "X-Request-Id": ctx.request_id("coach-restart")},
        canonical=True,
        expect_request_id=True,
    )
    require(restarted.status == 200, f"restart 실패 {restarted.status}")
    ctx.register(restarted.parsed["session_id"], "coach_session")
    ctx.call(
        "coach.reply-closed",
        "post",
        "/v2/coach/reply",
        json={"session_id": coach_session_id, "text": "닫힌 세션"},
        headers={**headers, "X-Request-Id": ctx.request_id("coach-reply-closed")},
    )

    # coach start 가 첫 턴에서 complete 되면서 리포트 파싱이 깨진다 → 502
    bad_intent = create_upload(ctx, "manifest-bad", headers)
    bad_created = ctx.call(
        "coach.bad-session",
        "post",
        "/v2/practice-sessions",
        json=session_body(bad_intent, blockage_detail=f"끝내죠 {BAD_REPORT_MARKER}"),
        headers={**headers, "X-Request-Id": ctx.request_id("bad-create")},
        expect_request_id=True,
    )
    require(bad_created.status == 202, "bad 세션 생성 실패")
    bad_session_id = bad_created.parsed["session_id"]
    ctx.register(bad_session_id, "practice_session")
    ctx.control("manifest.worker-bad", "run-worker-once")
    retry_request_id = ctx.request_id("coach-start-502")
    for attempt in range(3):
        step_id = "coach.start-502" if attempt == 0 else f"coach.start-502-{attempt}"
        ctx.call(
            step_id,
            "post",
            "/v2/coach/start",
            json={"practice_session_id": bad_session_id, "restart": True},
            headers={**headers, "X-Request-Id": retry_request_id},
        )
    # 4번째는 attempt 가 소진돼 클레임을 못 딴다 → 409 request retry exhausted
    ctx.call(
        "sync.retry-exhausted",
        "post",
        "/v2/coach/start",
        json={"practice_session_id": bad_session_id, "restart": True},
        headers={**headers, "X-Request-Id": retry_request_id},
    )
    ctx.control("manifest.retry-projection", "db-projection", include=["external_operations"])

    # coach/confirm 과 reports 가 kind='report' 네임스페이스를 공유한다 (§구현 규약 ⑧)
    good_start = ctx.call(
        "coach.good-start",
        "post",
        "/v2/coach/start",
        json={"practice_session_id": session_id, "restart": True},
        headers={**headers, "X-Request-Id": ctx.request_id("good-start")},
        canonical=True,
        expect_request_id=True,
    )
    require(good_start.status == 200, f"good start 실패 {good_start.status}")
    good_session_id = good_start.parsed["session_id"]
    ctx.register(good_session_id, "coach_session")
    completed = ctx.call(
        "coach.good-complete",
        "post",
        "/v2/coach/reply",
        json={"session_id": good_session_id, "text": f"정리하죠 {COMPLETE_MARKER}"},
        headers={**headers, "X-Request-Id": ctx.request_id("good-complete")},
        canonical=True,
        expect_request_id=True,
    )
    require(
        completed.status == 200 and completed.parsed["status"] == "complete",
        f"complete 실패 {completed.status} {completed.body!r}",
    )
    ctx.register(completed.parsed["handoff"]["id"], "handoff")
    shared_request_id = ctx.request_id("kind-collision")
    ctx.call(
        "sync.kind-collision-first",
        "post",
        "/v2/reports",
        json={"session_id": good_session_id},
        headers={**headers, "X-Request-Id": shared_request_id},
        canonical=True,
        expect_request_id=True,
    )
    ctx.call(
        "sync.kind-collision",
        "post",
        "/v2/coach/confirm",
        json={
            "coach_session_id": good_session_id,
            "confirmed": True,
            "rebuttal_text": None,
        },
        headers={**headers, "X-Request-Id": shared_request_id},
    )

    # --- community --------------------------------------------------------
    one = ctx.auth(cfg.SEED_USER_IDS[0])
    seed_post = cfg.SEED_POST_IDS[2]
    seed_comment = cfg.SEED_COMMENT_IDS[0]

    ctx.call(
        "community.get-missing",
        "get",
        "/v2/community/posts/{post_id}",
        path_params={"post_id": MISSING},
    )
    ctx.call(
        "community.patch-missing",
        "patch",
        "/v2/community/posts/{post_id}",
        path_params={"post_id": MISSING},
        json={"title": "t", "body": "b"},
        headers=one,
    )
    ctx.call(
        "community.patch-not-author",
        "patch",
        "/v2/community/posts/{post_id}",
        path_params={"post_id": seed_post},
        json={"title": "t", "body": "b"},
        headers=ctx.auth(cfg.SEED_USER_IDS[3]),
    )
    ctx.call(
        "community.delete-missing",
        "delete",
        "/v2/community/posts/{post_id}",
        path_params={"post_id": MISSING},
        headers=one,
    )
    ctx.call(
        "community.delete-not-author",
        "delete",
        "/v2/community/posts/{post_id}",
        path_params={"post_id": seed_post},
        headers=ctx.auth(cfg.SEED_USER_IDS[3]),
    )
    ctx.call(
        "community.unknown-category",
        "post",
        "/v2/community/posts",
        json={
            "category_slug": "no-such-category",
            "title": "t",
            "body": "b",
            "anonymous": False,
        },
        headers=one,
    )
    ctx.call(
        "community.like-missing",
        "post",
        "/v2/community/posts/{post_id}/likes",
        path_params={"post_id": MISSING},
        headers=one,
    )
    ctx.call(
        "community.unlike-missing",
        "delete",
        "/v2/community/posts/{post_id}/likes",
        path_params={"post_id": MISSING},
        headers=one,
    )
    ctx.call(
        "community.comments-missing",
        "get",
        "/v2/community/posts/{post_id}/comments",
        path_params={"post_id": MISSING},
    )
    ctx.call(
        "community.comments-bad-cursor",
        "get",
        "/v2/community/posts/{post_id}/comments",
        path_params={"post_id": cfg.SEED_POST_IDS[0]},
        params={"cursor": "!!"},
    )
    ctx.call(
        "community.comment-create-missing",
        "post",
        "/v2/community/posts/{post_id}/comments",
        path_params={"post_id": MISSING},
        json={"body": "b", "anonymous": False},
        headers=one,
    )
    ctx.call(
        "community.comment-patch-missing",
        "patch",
        "/v2/community/comments/{comment_id}",
        path_params={"comment_id": MISSING},
        json={"body": "b", "anonymous": False},
        headers=one,
    )
    ctx.call(
        "community.comment-patch-not-author",
        "patch",
        "/v2/community/comments/{comment_id}",
        path_params={"comment_id": seed_comment},
        json={"body": "b", "anonymous": False},
        headers=ctx.auth(cfg.SEED_USER_IDS[3]),
    )
    ctx.call(
        "community.comment-delete-missing",
        "delete",
        "/v2/community/comments/{comment_id}",
        path_params={"comment_id": MISSING},
        headers=one,
    )
    ctx.call(
        "community.comment-delete-not-author",
        "delete",
        "/v2/community/comments/{comment_id}",
        path_params={"comment_id": seed_comment},
        headers=ctx.auth(cfg.SEED_USER_IDS[3]),
    )
    ctx.call(
        "community.report-missing",
        "post",
        "/v2/community/reports",
        json={
            "target_type": "post",
            "target_id": MISSING,
            "reason": "spam",
            "detail": None,
        },
        headers=one,
    )
    ctx.call(
        "community.report-own",
        "post",
        "/v2/community/reports",
        json={
            "target_type": "post",
            "target_id": cfg.SEED_POST_IDS[0],
            "reason": "spam",
            "detail": None,
        },
        headers=ctx.auth(_author_of(0)),
    )
    ctx.call(
        "community.block-self",
        "post",
        "/v2/community/blocks",
        json={"user_id": cfg.SEED_USER_IDS[0]},
        headers=one,
    )
    ctx.call(
        "community.block-unknown",
        "post",
        "/v2/community/blocks",
        json={"user_id": MISSING},
        headers=one,
    )


def _author_of(post_index: int) -> str:
    """시드 글의 작성자 (seed.py:_post_row 와 같은 규칙)."""
    return cfg.SEED_USER_IDS[post_index % 3]
