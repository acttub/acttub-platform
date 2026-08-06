"""오류 계약 실행 manifest.

AST 결과는 **drift inventory 로만** 쓴다 — 추출기는 `raise HTTPException(...)` 을
찾을 뿐 어떤 요청이 그 분기에 도달하는지 모른다. 판정은 여기 있는 실행 manifest 가
한다(§오류 계약 🔎).

**inventory 의 모든 항목은 manifest 케이스에 연결되거나 명시적 제외 사유를 달아야
한다.** 미연결이 하나라도 남으면 `--check-manifest` 가 실패한다.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from contract_harness.inventory import ErrorSite, error_inventory


def key(source_tail: str, symbol: str, status, detail) -> str:
    return f"{source_tail}:{symbol}|{status}|{detail}"


API = "acting-api/src/acting_api"
AGENT = "acting-agent/src/acting_agent"
SUMMARY = "acting-summary/src/acting_summary"


@dataclass(frozen=True)
class Case:
    case_id: str
    keys: tuple[str, ...]
    scenario: str
    step: str
    status: int
    detail: object
    note: str = ""


@dataclass(frozen=True)
class Exclusion:
    keys: tuple[str, ...]
    reason: str


CASES: tuple[Case, ...] = (
    # --- 인증·인가 (라우트 밖) -------------------------------------------
    Case(
        "auth.missing-token",
        (key(f"{API}/auth/dependencies.py", "build_current_user_dependency.current_user",
             401, "invalid or missing access token"),),
        "token-corpus", "token.no-header", 401, "invalid or missing access token",
        note="의존성에서 나는 401 — 라우트가 아니다",
    ),
    Case(
        "auth.optional-bad-token",
        (key(f"{API}/auth/dependencies.py", "build_optional_user_dependency.optional_user",
             401, "invalid or missing access token"),),
        "token-corpus", "optional.bad-token", 401, "invalid or missing access token",
    ),
    Case(
        "auth.suspended-current-user",
        (key(f"{API}/auth/dependencies.py", "build_current_user_dependency.current_user",
             403, "account_suspended"),),
        "error-manifest", "suspended.me", 403, "account_suspended",
    ),
    Case(
        "auth.suspended-optional-user",
        (key(f"{API}/auth/dependencies.py", "build_optional_user_dependency.optional_user",
             403, "account_suspended"),),
        "error-manifest", "suspended.community", 403, "account_suspended",
    ),
    Case(
        "auth.consent-gate",
        (key(f"{API}/auth/dependencies.py", "build_consent_gate_dependency.consented_user",
             403, "consent_required"),),
        "consent-gate", "uploads", 403, "consent_required",
    ),
    Case(
        "auth.user-rate-limit",
        (key(f"{API}/auth/dependencies.py",
             "build_rate_limited_user_dependency.rate_limited_user",
             429, "rate limit exceeded"),),
        "rate-limiter", "blocked", 429, "rate limit exceeded",
    ),
    Case(
        "auth.router-user-rate-limit",
        (key(f"{API}/auth/router.py", "build_router.enforce_rate_limit",
             429, "rate limit exceeded"),),
        "rate-limiter", "logout-rate-limited", 429, "rate limit exceeded",
    ),
    Case(
        "auth.router-ip-rate-limit",
        (key(f"{API}/auth/router.py", "build_router.enforce_ip_rate_limit",
             429, "rate limit exceeded"),),
        "rate-limiter", "ip-blocked", 429, "rate limit exceeded",
    ),
    Case(
        "auth.unsupported-provider",
        (key(f"{API}/auth/router.py", "build_router.login", 400, "unsupported_provider"),),
        "error-manifest", "login.unsupported-provider", 400, "unsupported_provider",
    ),
    Case(
        "auth.invalid-provider-token",
        (key(f"{API}/auth/router.py", "build_router.login", 401, "invalid_provider_token"),),
        "error-manifest", "login.invalid-token", 401, "invalid_provider_token",
    ),
    Case(
        "auth.provider-not-configured",
        (key(f"{API}/auth/router.py", "build_router.login", 503, "provider_not_configured"),),
        "error-manifest", "login.unconfigured-provider", 503, "provider_not_configured",
    ),
    Case(
        "auth.account-exists-other-provider",
        (key(f"{API}/auth/router.py", "build_router.login", 409,
             "account_exists_with_different_provider"),),
        "error-manifest", "login.email-collision", 409,
        "account_exists_with_different_provider",
    ),
    Case(
        "auth.login-suspended",
        (key(f"{API}/auth/router.py", "build_router.login", 403, "account_suspended"),),
        "error-manifest", "login.suspended", 403, "account_suspended",
    ),
    Case(
        "auth.refresh-suspended",
        (key(f"{API}/auth/router.py", "build_router.refresh", 403, "account_suspended"),),
        "error-manifest", "refresh.suspended", 403, "account_suspended",
    ),
    Case(
        "auth.refresh-invalid",
        (key(f"{API}/auth/router.py", "build_router.refresh", 401, "invalid_refresh_token"),),
        "refresh-rotation", "reuse-old", 401, "invalid_refresh_token",
    ),
    Case(
        "auth.logout-invalid",
        (key(f"{API}/auth/router.py", "build_router.logout", 401, "invalid_refresh_token"),),
        "error-manifest", "logout.invalid", 401, "invalid_refresh_token",
    ),
    # --- 자격증명 handler --------------------------------------------------
    Case(
        "storage.credentials-handler",
        (key(f"{API}/app.py", "create_app.storage_credentials_error_handler",
             503, "storage_not_configured"),),
        "error-manifest", "uploads.credentials-error", 503, "storage_not_configured",
        note="라우트가 아니라 app.py 의 exception handler 에서 난다",
    ),
    Case(
        "storage.uploads-not-configured",
        (key(f"{API}/uploads.py", "build_router.require_storage",
             503, "storage_not_configured"),),
        "no-storage", "uploads-intent", 503, "storage_not_configured",
    ),
    Case(
        "storage.session-detail-not-configured",
        (key(f"{API}/practice_sessions.py", "build_router.get_session",
             503, "storage_not_configured"),),
        "no-storage", "session-detail", 503, "storage_not_configured",
    ),
    Case(
        "storage.report-detail-not-configured",
        (key(f"{API}/reports.py", "build_router.report_detail",
             503, "storage_not_configured"),),
        "no-storage", "report-detail", 503, "storage_not_configured",
    ),
    # --- admin ------------------------------------------------------------
    Case(
        "admin.unauthorized",
        (key(f"{API}/admin.py", "build_router.require_token", 401, None),),
        "admin", "stats-unauthorized", 401, "Unauthorized",
        note="detail 인자가 없어 FastAPI 기본 문구(Unauthorized)가 나간다",
    ),
    # --- admissions -------------------------------------------------------
    Case(
        "admissions.university-not-found",
        (key(f"{API}/admissions.py", "build_router.get_university", 404,
             "university_not_found"),),
        "admissions", "admissions-missing", 404, "university_not_found",
    ),
    # --- consents ---------------------------------------------------------
    Case(
        "consents.document-not-found",
        (key(f"{API}/consents.py", "build_router.record_consent", 404,
             "consent_document_not_found"),),
        "error-manifest", "consents.unknown-document", 404, "consent_document_not_found",
    ),
    # --- uploads ----------------------------------------------------------
    Case(
        "uploads.intent-not-found",
        (key(f"{API}/uploads.py", "build_router.complete_intent", 404,
             "upload_intent_not_found"),),
        "error-manifest", "uploads.complete-missing", 404, "upload_intent_not_found",
    ),
    Case(
        "uploads.object-missing",
        (key(f"{API}/uploads.py", "build_router.complete_intent", 409, "upload_not_found"),),
        "error-manifest", "uploads.head-missing", 409, "upload_not_found",
    ),
    Case(
        "uploads.size-mismatch",
        (key(f"{API}/uploads.py", "build_router.complete_intent", 409,
             "upload_size_mismatch"),),
        "error-manifest", "uploads.head-size-mismatch", 409, "upload_size_mismatch",
    ),
    Case(
        "uploads.too-large",
        (key(f"{API}/uploads.py", "build_router.create_intent", 413, "upload_too_large"),),
        "request-validation", "too-large", 413, "upload_too_large",
    ),
    Case(
        "uploads.unsupported-media",
        (key(f"{API}/uploads.py", "build_router.create_intent", 415,
             "unsupported_media_type"),),
        "request-validation", "mime-not-video", 415, "unsupported_media_type",
    ),
    # --- practice sessions -------------------------------------------------
    Case(
        "practice.upload-intent-not-found",
        (key(f"{API}/practice_sessions.py", "build_router.create_session", 404,
             "upload_intent_not_found"),),
        "error-manifest", "practice.missing-intent", 404, "upload_intent_not_found",
    ),
    Case(
        "practice.upload-intent-not-finalized",
        (key(f"{API}/practice_sessions.py", "build_router.create_session", 409,
             "upload_intent_not_finalized"),),
        "error-manifest", "practice.unfinalized-intent", 409, "upload_intent_not_finalized",
    ),
    Case(
        "practice.fingerprint-mismatch",
        (key(f"{API}/practice_sessions.py", "build_router.create_session", 422,
             "request_fingerprint_mismatch"),),
        "error-manifest", "practice.fingerprint-mismatch", 422, "request_fingerprint_mismatch",
    ),
    Case(
        "practice.delete-not-found",
        (key(f"{API}/practice_sessions.py", "build_router.delete_session", 404,
             "practice_session_not_found"),),
        "consent-gate", "session-delete", 404, "practice_session_not_found",
        note="미동의 상태에서도 consent 403 이 아니라 실제 처리 결과가 나와야 한다",
    ),
    Case(
        "practice.status-not-found",
        (key(f"{API}/practice_sessions.py", "build_router.get_session_status", 404,
             "practice_session_not_found"),),
        "error-manifest", "practice.status-missing", 404, "practice_session_not_found",
    ),
    Case(
        "practice.detail-not-found",
        (key(f"{API}/practice_sessions.py", "build_router.get_session", 404,
             "practice_session_not_found"),),
        "error-manifest", "practice.detail-missing", 404, "practice_session_not_found",
    ),
    Case(
        "practice.reanalyze-not-found",
        (key(f"{API}/practice_sessions.py", "build_router.reanalyze_session", 404,
             "practice_session_not_found"),),
        "error-manifest", "practice.reanalyze-missing", 404, "practice_session_not_found",
    ),
    Case(
        "practice.reanalyze-not-failed",
        (key(f"{API}/practice_sessions.py", "build_router.reanalyze_session", 409,
             "session_is_not_failed"),),
        "reanalyze", "retry-not-failed", 409, "session_is_not_failed",
    ),
    Case(
        "practice.reanalyze-fingerprint",
        (key(f"{API}/practice_sessions.py", "build_router.reanalyze_session", 422,
             "request_fingerprint_mismatch"),),
        "error-manifest", "practice.reanalyze-fingerprint", 422,
        "request_fingerprint_mismatch",
        note="같은 X-Request-Id 를 다른 세션의 재분석에 재사용하면 fingerprint 가 어긋난다",
    ),
    Case(
        "practice.retry-exhausted",
        (key(f"{API}/practice_sessions.py", "_idempotent_response", 409,
             "analysis_retry_exhausted"),),
        "worker-failure", "retry-exhausted", 409, "analysis_retry_exhausted",
    ),
    Case(
        "practice.blockage-branch",
        (key(f"{API}/practice_sessions.py",
             "PracticeSessionRequest.validate_blockage_branch", 422,
             "sub_branch does not match blockage_kind"),),
        "request-validation", "branch.analysis-bad", 422, None,
        note="Pydantic validator — HTTPException 이 아니라 422 detail 배열이다",
    ),
    # --- coach ------------------------------------------------------------
    Case(
        "coach.start-not-found",
        (key(f"{API}/coaching.py", "build_router.coach_start", 404,
             "practice session not found"),),
        "error-manifest", "coach.start-missing", 404, "practice session not found",
        note="같은 404 라도 여기는 공백 포함 문장이다 (practice_session_not_found 아님)",
    ),
    Case(
        "coach.start-not-settled",
        (key(f"{API}/coaching.py", "build_router.coach_start", 409,
             "practice session analysis is not settled"),),
        "error-manifest", "coach.start-analyzing", 409,
        "practice session analysis is not settled",
    ),
    Case(
        "coach.start-report-exists",
        (key(f"{API}/coaching.py", "build_router.coach_start", 409,
             "report already exists for practice session"),),
        "coach-resume", "conflict-resume-branch", 409,
        "report already exists for practice session",
        note="resume 분기와 클레임 뒤 두 지점에서 같은 응답이 난다 — 부작용은 다르다",
    ),
    Case(
        "coach.start-report-parse-error",
        (key(f"{API}/coaching.py", "build_router.coach_start", 502, "str(exc)"),),
        "error-manifest", "coach.start-502", 502, None,
        note="동적 detail — 스텁이 던지는 파싱 오류를 고정해 결정적으로 만든다",
    ),
    Case(
        "coach.reply-not-found",
        (key(f"{API}/coaching.py", "build_router.coach_reply", 404, "session not found"),),
        "error-manifest", "coach.reply-missing", 404, "session not found",
    ),
    Case(
        "coach.reply-closed",
        (key(f"{API}/coaching.py", "build_router.coach_reply", 409, "session is closed"),),
        "error-manifest", "coach.reply-closed", 409, "session is closed",
    ),
    Case(
        "coach.reply-report-parse-error",
        (key(f"{API}/coaching.py", "build_router.coach_reply", 502, "str(exc)"),),
        "error-manifest", "coach.reply-502", 502, None,
    ),
    Case(
        "coach.confirm-not-found",
        (key(f"{API}/coaching.py", "build_router.coach_confirm", 404, "session not found"),),
        "error-manifest", "coach.confirm-missing", 404, "session not found",
    ),
    Case(
        "coach.confirm-rebuttal-required",
        (key(f"{API}/coaching.py", "CoachConfirmReq.validate_rebuttal", 422,
             "rebuttal_text is required when confirmed is false"),),
        "request-validation", "confirm.blank", 422, None,
    ),
    # --- reports ----------------------------------------------------------
    Case(
        "reports.session-not-found",
        (key(f"{API}/reports.py", "build_router.create_report", 404, "session not found"),),
        "error-manifest", "reports.missing-session", 404, "session not found",
    ),
    Case(
        "reports.detail-not-found",
        (key(f"{API}/reports.py", "build_router.report_detail", 404, "report_not_found"),),
        "error-manifest", "reports.detail-missing", 404, "report_not_found",
    ),
    # --- sync operations ---------------------------------------------------
    Case(
        "sync.invalid-request-id",
        (key(f"{API}/sync_operations.py", "parse_request_id", 422, "invalid X-Request-Id"),),
        "request-validation", "invalid-request-id", 422, "invalid X-Request-Id",
    ),
    Case(
        "sync.fingerprint-mismatch",
        (key(f"{API}/sync_operations.py", "begin_sync_operation", 422,
             "request_fingerprint_mismatch"),),
        "error-manifest", "sync.kind-collision", 422, "request_fingerprint_mismatch",
        note="coach/confirm 과 reports 가 kind='report' 네임스페이스를 공유한다 (§구현 규약 ⑧)",
    ),
    Case(
        "sync.retry-exhausted",
        (key(f"{API}/sync_operations.py", "begin_sync_operation", 409,
             "request retry exhausted"),),
        "error-manifest", "sync.retry-exhausted", 409, "request retry exhausted",
    ),
    # --- profile ----------------------------------------------------------
    Case(
        "profile.nickname-blank",
        (key(f"{API}/profile.py", "UpdateMeRequest._normalize", 422,
             "nickname must not be blank"),),
        "request-validation", "nickname.blank", 422, None,
    ),
    # --- community --------------------------------------------------------
    Case(
        "community.post-not-found",
        (key(f"{API}/community.py", "build_router.get_post", 404, "post_not_found"),),
        "error-manifest", "community.get-missing", 404, "post_not_found",
    ),
    Case(
        "community.post-update-not-found",
        (key(f"{API}/community.py", "build_router.update_post", 404, "post_not_found"),),
        "error-manifest", "community.patch-missing", 404, "post_not_found",
    ),
    Case(
        "community.post-update-not-author",
        (key(f"{API}/community.py", "build_router.update_post", 403, "not_author"),),
        "error-manifest", "community.patch-not-author", 403, "not_author",
    ),
    Case(
        "community.post-delete-not-found",
        (key(f"{API}/community.py", "build_router.delete_post", 404, "post_not_found"),),
        "error-manifest", "community.delete-missing", 404, "post_not_found",
    ),
    Case(
        "community.post-delete-not-author",
        (key(f"{API}/community.py", "build_router.delete_post", 403, "not_author"),),
        "error-manifest", "community.delete-not-author", 403, "not_author",
    ),
    Case(
        "community.category-not-found",
        (key(f"{API}/community.py", "build_router.create_post", 404, "category_not_found"),),
        "error-manifest", "community.unknown-category", 404, "category_not_found",
    ),
    Case(
        "community.like-not-found",
        (key(f"{API}/community.py", "build_router.like_post", 404, "post_not_found"),),
        "error-manifest", "community.like-missing", 404, "post_not_found",
    ),
    Case(
        "community.unlike-not-found",
        (key(f"{API}/community.py", "build_router.unlike_post", 404, "post_not_found"),),
        "error-manifest", "community.unlike-missing", 404, "post_not_found",
    ),
    Case(
        "community.comment-list-not-found",
        (key(f"{API}/community.py", "build_router.list_comments", 404, "post_not_found"),),
        "error-manifest", "community.comments-missing", 404, "post_not_found",
    ),
    Case(
        "community.comment-list-invalid-cursor",
        (key(f"{API}/community.py", "build_router.list_comments", 400, "invalid_cursor"),),
        "error-manifest", "community.comments-bad-cursor", 400, "invalid_cursor",
    ),
    Case(
        "community.post-list-invalid-cursor",
        (key(f"{API}/community.py", "build_router.list_posts", 400, "invalid_cursor"),),
        "community-traversal", "invalid-cursor", 400, "invalid_cursor",
    ),
    Case(
        "community.comment-create-not-found",
        (key(f"{API}/community.py", "build_router.create_comment", 404, "post_not_found"),),
        "error-manifest", "community.comment-create-missing", 404, "post_not_found",
    ),
    Case(
        "community.comment-update-not-found",
        (key(f"{API}/community.py", "build_router.update_comment", 404, "comment_not_found"),),
        "error-manifest", "community.comment-patch-missing", 404, "comment_not_found",
    ),
    Case(
        "community.comment-update-not-author",
        (key(f"{API}/community.py", "build_router.update_comment", 403, "not_author"),),
        "error-manifest", "community.comment-patch-not-author", 403, "not_author",
    ),
    Case(
        "community.comment-delete-not-found",
        (key(f"{API}/community.py", "build_router.delete_comment", 404, "comment_not_found"),),
        "error-manifest", "community.comment-delete-missing", 404, "comment_not_found",
    ),
    Case(
        "community.comment-delete-not-author",
        (key(f"{API}/community.py", "build_router.delete_comment", 403, "not_author"),),
        "error-manifest", "community.comment-delete-not-author", 403, "not_author",
    ),
    Case(
        "community.report-target-not-found",
        (key(f"{API}/community.py", "build_router.create_report", 404, "target_not_found"),),
        "error-manifest", "community.report-missing", 404, "target_not_found",
    ),
    Case(
        "community.report-own",
        (key(f"{API}/community.py", "build_router.create_report", 400, "cannot_report_own"),),
        "error-manifest", "community.report-own", 400, "cannot_report_own",
    ),
    Case(
        "community.report-duplicate",
        (key(f"{API}/community.py", "build_router.create_report", 409, "already_reported"),),
        "community", "report-duplicate", 409, "already_reported",
    ),
    Case(
        "community.block-self",
        (key(f"{API}/community.py", "build_router.block_user", 400, "cannot_block_self"),),
        "error-manifest", "community.block-self", 400, "cannot_block_self",
    ),
    Case(
        "community.block-unknown-user",
        (key(f"{API}/community.py", "build_router.block_user", 404, "user_not_found"),),
        "error-manifest", "community.block-unknown", 404, "user_not_found",
    ),
)


EXCLUSIONS: tuple[Exclusion, ...] = (
    Exclusion(
        (
            key(f"{AGENT}/router.py", "build_router.coach_reply", 404, "session not found"),
            key(f"{AGENT}/router.py", "build_router.coach_reply", 409,
                "session changed concurrently"),
            key(f"{AGENT}/router.py", "build_router.coach_start", 404,
                "practice session not found"),
            key(f"{SUMMARY}/router.py", "build_router.summarize_endpoint", 502, "str(exc)"),
            key(f"{SUMMARY}/router.py", "build_router.summarize_endpoint", 504, "str(exc)"),
        ),
        "acting-agent·acting-summary 자체 라우터는 게이트웨이에 마운트되지 않는다. "
        "v1 경로는 404 가 계약이다(/SPEC.md §6 #14).",
    ),
    Exclusion(
        (key(f"{API}/app.py", "_mount_static_frontend.serve_frontend", 404, None),),
        "STATIC_DIR 이 설정된 배포에서만 등록되는 catch-all 이다. contract 프로파일은 "
        "정적 프론트를 마운트하지 않으므로 라우트 자체가 없다.",
    ),
    Exclusion(
        (key(f"{API}/practice_sessions.py", "_idempotent_response", 409,
             "invalid_operation_state"),),
        "OperationStatus 4개(pending/running/succeeded/failed)가 모두 앞 분기에서 "
        "처리되므로 도달할 수 없는 방어 코드다.",
    ),
    Exclusion(
        (key(f"{API}/profile.py", "build_router.update_me", 404, "user_not_found"),),
        "인증 의존성이 이미 유저를 읽은 뒤라, 같은 요청 안에서 유저가 사라져야 도달한다. "
        "API 만으로는 만들 수 없다.",
    ),
    Exclusion(
        (key(f"{API}/uploads.py", "build_router.complete_intent", 413, "upload_too_large"),),
        "상한을 낮춘 배포 이전에 발급된 pending intent 를 재검증하는 분기다. 한 프로세스 "
        "안에서는 MAX_UPLOAD_BYTES 가 바뀌지 않아 도달할 수 없다.",
    ),
    Exclusion(
        (key(f"{API}/uploads.py", "build_router.complete_intent", 409,
             "upload_intent_expired"),),
        "intent 만료를 앞당기려면 앱 내부 wall clock 주입이 필요하다. "
        "uploads.build_router 의 utcnow 인자를 create_app 이 넘기지 않아 주입점이 없고, "
        "제어 표면의 advance-clock 은 monotonic(레이트리밋)과 워커 경로만 움직인다.",
    ),
    Exclusion(
        (
            key(f"{API}/coaching.py", "build_router.coach_start", 409,
                "request is still processing"),
            key(f"{API}/coaching.py", "build_router.coach_reply", 409,
                "request is still processing"),
            key(f"{API}/coaching.py", "build_router.coach_confirm", 409,
                "request is still processing"),
            key(f"{API}/reports.py", "build_router.create_report", 409,
                "request is still processing"),
            key(f"{API}/sync_operations.py", "_existing_operation_response", 409,
                "request is still processing"),
        ),
        "lease 가 살아 있는 running 상태를 결정적으로 만들려면 요청을 처리 도중에 "
        "멈추는 훅이 필요하다. 제어 표면 5개에 그런 것이 없고, 동시성 시나리오에서는 "
        "인터리빙에 따라 관측될 뿐이라 결정적 manifest 케이스로 두지 않는다.",
    ),
    Exclusion(
        (
            key(f"{API}/coaching.py", "build_router.coach_confirm", 409,
                "report already exists"),
            key(f"{API}/reports.py", "build_router.create_report", 409,
                "report already exists"),
        ),
        "두 라우트 모두 handoff 의 기존 리포트를 먼저 조회해 재사용하므로, "
        "complete_practice_report_operation 의 ON CONFLICT 가 걸리는 것은 같은 handoff 를 "
        "동시에 확정하는 경우뿐이다. 결정적으로 재현할 수 없다.",
    ),
    Exclusion(
        (key(f"{API}/coaching.py", "build_router.coach_reply", 409,
             "session changed concurrently"),),
        "SessionWriteConflict 는 두 요청이 같은 코치 세션의 턴을 동시에 덮어쓸 때만 난다. "
        "동시성 시나리오가 이 경로를 밟지만 결과가 인터리빙에 좌우된다.",
    ),
    Exclusion(
        (
            key(f"{API}/coaching.py", "build_router.coach_confirm", 502, "str(exc)"),
            key(f"{API}/reports.py", "build_router.create_report", 502, "str(exc)"),
        ),
        "이 두 곳에서 리포트 LLM 을 실제로 부르려면 handoff 는 확정됐는데 practice_report 는 "
        "없는 상태가 필요하다. 코치 완료 턴이 그 자리에서 리포트를 저장하므로"
        "(db/store.py:PostgresStore.complete_coach_reply_operation) 순차 호출로는 만들 수 없다. "
        "같은 ReportParseError 경로는 coach_start·coach_reply 케이스가 덮는다.",
    ),
)


def covered_keys() -> set[str]:
    return {item for case in CASES for item in case.keys}


def excluded_keys() -> dict[str, str]:
    return {
        item: exclusion.reason
        for exclusion in EXCLUSIONS
        for item in exclusion.keys
    }


@dataclass
class ManifestReport:
    inventory: list[ErrorSite] = field(default_factory=list)
    unlinked: list[ErrorSite] = field(default_factory=list)
    stale_cases: list[str] = field(default_factory=list)
    stale_exclusions: list[str] = field(default_factory=list)

    def ok(self) -> bool:
        return not (self.unlinked or self.stale_cases or self.stale_exclusions)


def check() -> ManifestReport:
    inventory = error_inventory()
    known = {site.key for site in inventory}
    covered = covered_keys()
    excluded = excluded_keys()
    report = ManifestReport(inventory=inventory)
    report.unlinked = [
        site
        for site in inventory
        if site.key not in covered and site.key not in excluded
    ]
    report.stale_cases = sorted(covered - known)
    report.stale_exclusions = sorted(set(excluded) - known)
    return report
