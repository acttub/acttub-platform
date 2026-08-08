"""시나리오 공용 도구."""

from __future__ import annotations

from contract_harness import config as cfg
from contract_harness.framework import ScenarioAbort
from contract_harness.normalize import SymbolTable

VIDEO_MIME = "video/mp4"
DEFAULT_SIZE_BYTES = 4096


def bootstrap_symbols(symbols: SymbolTable) -> None:
    """시드가 만든 고정 ID 를 미리 등록한다.

    양쪽 스키마에서 값이 같으므로 심볼도 같다. 등록하지 않으면 정규화가
    "미등록 UUID" 로 실패한다 — 그것이 의도된 동작이다(§구현 규약 ①).
    """
    for user_id, _email, _nickname in cfg.SEED_USERS:
        symbols.register(user_id, "seed_user")
    symbols.register(cfg.SEED_SUSPENDED_USER[0], "seed_suspended_user")
    symbols.register(cfg.SEED_DEACTIVATED_USER[0], "seed_deactivated_user")
    for doc_id, *_rest in cfg.SEED_CONSENT_DOCUMENTS:
        symbols.register(doc_id, "seed_consent_document")
    for post_id in cfg.SEED_POST_IDS:
        symbols.register(post_id, "seed_post")
    for comment_id in cfg.SEED_COMMENT_IDS:
        symbols.register(comment_id, "seed_comment")
    for placeholder in cfg.PLACEHOLDER_UUIDS:
        symbols.register(placeholder, "placeholder")
    for value, kind in (
        (cfg.SEED_UPLOAD_INTENT_ID, "seed_upload_intent"),
        (cfg.SEED_PRACTICE_SESSION_ID, "seed_practice_session"),
        (cfg.SEED_SUMMARY_ID, "seed_summary"),
        (cfg.SEED_COACH_SESSION_ID, "seed_coach_session"),
        (cfg.SEED_HANDOFF_ID, "seed_handoff"),
        (cfg.SEED_PRACTICE_REPORT_ID, "seed_practice_report"),
    ):
        symbols.register(value, kind)


def require(condition, message: str) -> None:
    if not condition:
        raise ScenarioAbort(message)


def login(ctx, step_id: str, id_token: str, *, provider: str = "google") -> dict:
    step = ctx.call(
        step_id,
        "post",
        "/v2/auth/login",
        json={"provider": provider, "id_token": id_token},
    )
    require(step.status == 200, f"{step_id}: 로그인 실패 {step.status} {step.body!r}")
    body = step.parsed
    ctx.register(body["user"]["id"], "user")
    return body


def grant_all_consents(ctx, step_prefix: str, headers: dict) -> None:
    for index, (doc_id, *_rest) in enumerate(cfg.SEED_CONSENT_DOCUMENTS, start=1):
        step = ctx.call(
            f"{step_prefix}.consent{index}",
            "post",
            "/v2/consents",
            json={"document_id": doc_id, "action": "granted"},
            headers=headers,
        )
        require(step.status == 201, f"동의 기록 실패 {step.status}")
        ctx.register(step.parsed["id"], "consent_event")


def create_upload(ctx, step_prefix: str, headers: dict, *, mime_type=VIDEO_MIME,
                  size_bytes=DEFAULT_SIZE_BYTES, duration_ms=1500) -> str:
    intent = ctx.call(
        f"{step_prefix}.intent",
        "post",
        "/v2/uploads/intents",
        json={
            "mime_type": mime_type,
            "size_bytes": size_bytes,
            "duration_ms": duration_ms,
        },
        headers=headers,
    )
    require(intent.status == 201, f"업로드 intent 실패 {intent.status} {intent.body!r}")
    intent_id = intent.parsed["intent_id"]
    ctx.register(intent_id, "upload_intent")
    completed = ctx.call(
        f"{step_prefix}.complete",
        "post",
        "/v2/uploads/intents/{intent_id}/complete",
        path_params={"intent_id": intent_id},
        headers=headers,
    )
    require(completed.status == 200, f"업로드 complete 실패 {completed.status}")
    return intent_id


def session_body(intent_id: str, *, situation="오디션 직전", blockage_kind="분석",
                 sub_branch="대사 분석", blockage_detail="왜 지금 말하는지 모르겠어.") -> dict:
    return {
        "upload_intent_id": intent_id,
        "situation": situation,
        "character_context": "불안한 배우",
        "goal": "상대가 멈추게 한다",
        "blockage_kind": blockage_kind,
        "sub_branch": sub_branch,
        "blockage_detail": blockage_detail,
    }


def create_analyzed_session(ctx, step_prefix: str, headers: dict, *, tag: str,
                            body_overrides: dict | None = None) -> str:
    """업로드 → 세션 생성(202) → 워커 1틱 → analyzed 까지."""
    intent_id = create_upload(ctx, step_prefix, headers)
    body = session_body(intent_id, **(body_overrides or {}))
    request_id = ctx.request_id(f"{tag}-create")
    accepted = ctx.call(
        f"{step_prefix}.create",
        "post",
        "/v2/practice-sessions",
        json=body,
        headers={**headers, "X-Request-Id": request_id},
        expect_request_id=True,
    )
    require(accepted.status == 202, f"세션 생성 실패 {accepted.status} {accepted.body!r}")
    session_id = accepted.parsed["session_id"]
    ctx.register(session_id, "practice_session")
    ctx.control(f"{step_prefix}.worker", "run-worker-once")
    return session_id
