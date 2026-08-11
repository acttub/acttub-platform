"""동의 게이트 matrix · 토큰 corpus · refresh 회전 · rate limiter · 요청 validation."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import uuid
from datetime import datetime, timedelta, timezone

from contract_harness import config as cfg
from contract_harness.scenarios.support import grant_all_consents, login, require

MISSING_SESSION_ID = "00000000-0000-4000-8000-000000009001"
MISSING_COACH_SESSION_ID = "00000000-0000-4000-8000-000000009002"
MISSING_POST_ID = "00000000-0000-4000-8000-000000009003"


# --- 동의 전 matrix --------------------------------------------------------


def consent_gate_matrix(ctx) -> None:
    """미동의 상태에서 **403 이어야 할 것과 통과해야 할 것**을 각각 단언한다.

    셋업에서 무조건 동의부터 하면 `/v2/me` 나 community 읽기나 세션 삭제까지
    잘못 막는 구현이 통과한다(§게이트 둘을 셋업에서 처리).
    """
    tokens = login(ctx, "login", "harness-token-new-actor")
    headers = {"Authorization": f"Bearer {tokens['access_token']}"}

    # rate_limited_user — 통과해야 한다
    ctx.call("me", "get", "/v2/me", headers=headers)
    ctx.call("me-patch", "patch", "/v2/me", json={"nickname": "미동의"}, headers=headers)
    ctx.call("consents-pending", "get", "/v2/consents/pending", headers=headers)

    # optional_user — 통과해야 한다 (비로그인도 가능)
    ctx.call("community-list", "get", "/v2/community/posts", headers=headers)
    ctx.call("community-categories", "get", "/v2/community/categories", headers=headers)
    ctx.call(
        "community-detail",
        "get",
        "/v2/community/posts/{post_id}",
        path_params={"post_id": cfg.SEED_POST_IDS[0]},
        headers=headers,
    )

    # ungated_user — 인증만 요구한다. consent 403 이 아니라 실제 처리 결과(404).
    ctx.call(
        "session-delete",
        "delete",
        "/v2/practice-sessions/{session_id}",
        path_params={"session_id": MISSING_SESSION_ID},
        headers=headers,
    )

    # consented_user — 403 이어야 한다
    ctx.call(
        "uploads",
        "post",
        "/v2/uploads/intents",
        json={"mime_type": "video/mp4", "size_bytes": 4096, "duration_ms": 1000},
        headers=headers,
    )
    ctx.call("sessions-list", "get", "/v2/practice-sessions", headers=headers)
    ctx.call(
        "sessions-create",
        "post",
        "/v2/practice-sessions",
        json={
            "upload_intent_id": MISSING_SESSION_ID,
            "situation": "s",
            "character_context": "c",
            "goal": "g",
            "blockage_kind": "분석",
            "sub_branch": "대사 분석",
            "blockage_detail": None,
        },
        headers=headers,
    )
    ctx.call(
        "coach-start",
        "post",
        "/v2/coach/start",
        json={"practice_session_id": MISSING_SESSION_ID},
        headers=headers,
    )
    ctx.call(
        "reports",
        "post",
        "/v2/reports",
        json={"session_id": MISSING_COACH_SESSION_ID},
        headers=headers,
    )
    ctx.call(
        "community-write",
        "post",
        "/v2/community/posts",
        json={
            "category_slug": "free",
            "title": "막혀야 한다",
            "body": "동의 전에는 쓸 수 없다",
            "anonymous": False,
        },
        headers=headers,
    )

    grant_all_consents(ctx, "gate", headers)
    ctx.call("sessions-list-after", "get", "/v2/practice-sessions", headers=headers)


# --- 토큰 corpus -----------------------------------------------------------


def _b64(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _sign(header: dict, payload: dict, secret: str) -> str:
    encoded_header = _b64(json.dumps(header, separators=(",", ":"), sort_keys=True).encode())
    encoded_payload = _b64(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode())
    signing_input = f"{encoded_header}.{encoded_payload}".encode("ascii")
    signature = hmac.new(secret.encode(), signing_input, hashlib.sha256).digest()
    return f"{signing_input.decode('ascii')}.{_b64(signature)}"


def _claims(user_id: str, *, now: datetime, **overrides) -> dict:
    payload = {
        "iss": "acting-api",
        "aud": "acting-app",
        "sub": str(user_id),
        "jti": str(uuid.uuid4()),
        "token_type": "access",
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=30)).timestamp()),
    }
    payload.update(overrides)
    return payload


def token_corpus(ctx) -> None:
    """`auth/jwt.py:JwtService._decode` 가 거부해야 하는 것 전부 → 각각 401."""
    user_id = cfg.SEED_USER_IDS[0]
    now = datetime.now(timezone.utc)
    header = {"alg": "HS256", "typ": "JWT"}
    valid = _sign(header, _claims(user_id, now=now), cfg.JWT_SECRET)

    cases = {
        "valid": valid,
        "tampered-signature": valid[:-4] + ("aaaa" if not valid.endswith("aaaa") else "bbbb"),
        "wrong-secret": _sign(header, _claims(user_id, now=now), "another-secret"),
        "header-with-kid": _sign(
            {"alg": "HS256", "typ": "JWT", "kid": "harness"},
            _claims(user_id, now=now),
            cfg.JWT_SECRET,
        ),
        "header-alg-none": _sign(
            {"alg": "none", "typ": "JWT"}, _claims(user_id, now=now), cfg.JWT_SECRET
        ),
        "wrong-issuer": _sign(
            header, _claims(user_id, now=now, iss="other-api"), cfg.JWT_SECRET
        ),
        "wrong-audience": _sign(
            header, _claims(user_id, now=now, aud="other-app"), cfg.JWT_SECRET
        ),
        "wrong-token-type": _sign(
            header, _claims(user_id, now=now, token_type="refresh"), cfg.JWT_SECRET
        ),
        "future-iat": _sign(
            header,
            _claims(user_id, now=now, iat=int((now + timedelta(minutes=5)).timestamp())),
            cfg.JWT_SECRET,
        ),
        "exp-equals-now": _sign(
            header,
            _claims(user_id, now=now, exp=int(now.timestamp())),
            cfg.JWT_SECRET,
        ),
        "exp-one-second-ahead": _sign(
            header,
            _claims(user_id, now=now, exp=int(now.timestamp()) + 30),
            cfg.JWT_SECRET,
        ),
        "missing-claims": _sign(
            header,
            {"iss": "acting-api", "aud": "acting-app", "sub": str(user_id)},
            cfg.JWT_SECRET,
        ),
        "non-uuid-sub": _sign(
            header, _claims(user_id, now=now, sub="not-a-uuid"), cfg.JWT_SECRET
        ),
        "unknown-user": _sign(
            header,
            _claims("00000000-0000-4000-8000-000000009999", now=now),
            cfg.JWT_SECRET,
        ),
        "malformed": "not.a.jwt",
        "two-segments": ".".join(valid.split(".")[:2]),
    }
    for name, token in cases.items():
        ctx.call(
            f"token.{name}",
            "get",
            "/v2/me",
            headers={"Authorization": f"Bearer {token}"},
        )
    ctx.call("token.no-header", "get", "/v2/me")
    ctx.call(
        "token.wrong-scheme",
        "get",
        "/v2/me",
        headers={"Authorization": f"Basic {valid}"},
    )
    # optional_user 는 토큰이 아예 없으면 익명으로 통과하지만, 있는데 못 쓰면 401 이다.
    ctx.call("optional.anonymous", "get", "/v2/community/posts")
    ctx.call(
        "optional.bad-token",
        "get",
        "/v2/community/posts",
        headers={"Authorization": "Bearer not.a.jwt"},
    )


# --- refresh 회전 ----------------------------------------------------------


def refresh_rotation(ctx) -> None:
    """소진 토큰 재사용 시 **해당 유저 전 세션**이 무효화된다."""
    first = login(ctx, "login-1", "harness-token-new-actor")
    second = login(ctx, "login-2", "harness-token-new-actor")
    ctx.control("before", "db-projection", include=["refresh_tokens"])

    rotated = ctx.call(
        "rotate",
        "post",
        "/v2/auth/refresh",
        json={"refresh_token": first["refresh_token"]},
    )
    require(rotated.status == 200, f"회전 실패 {rotated.status}")
    ctx.control("after-rotate", "db-projection", include=["refresh_tokens"])

    ctx.call(
        "reuse-old",
        "post",
        "/v2/auth/refresh",
        json={"refresh_token": first["refresh_token"]},
    )
    ctx.control("after-reuse", "db-projection", include=["refresh_tokens"])

    # 다른 세션의 replacement 까지 거부되는 것이 계약이다.
    ctx.call(
        "other-session",
        "post",
        "/v2/auth/refresh",
        json={"refresh_token": second["refresh_token"]},
    )
    ctx.call(
        "replacement",
        "post",
        "/v2/auth/refresh",
        json={"refresh_token": rotated.parsed["refresh_token"]},
    )
    ctx.control("final", "db-projection", include=["refresh_tokens"])


# --- rate limiter ----------------------------------------------------------


def rate_limiter(ctx) -> None:
    """메인 플로우와 분리된 fresh 앱에서 경계를 의도적으로 넘는다."""
    user_headers = ctx.auth(cfg.SEED_USER_IDS[0])
    other_headers = ctx.auth(cfg.SEED_USER_IDS[1])

    statuses = []
    for index in range(61):
        response = ctx.backend.request("GET", "/v2/me", headers=user_headers)
        statuses.append(response.status)
    ctx.note(
        "user-window",
        {
            "first_60_all_ok": statuses[:60] == [200] * 60,
            "sixty_first": statuses[60],
        },
    )
    ctx.call("blocked", "get", "/v2/me", headers=user_headers)
    # auth 라우터의 유저 키 limiter 도 같은 카운터를 본다.
    ctx.call(
        "logout-rate-limited",
        "post",
        "/v2/auth/logout",
        json={"refresh_token": "not.a.token"},
        headers=user_headers,
    )
    ctx.call("other-user-not-blocked", "get", "/v2/me", headers=other_headers)

    ctx.control("rollover", "advance-clock", seconds=60)
    ctx.call("after-rollover", "get", "/v2/me", headers=user_headers)

    # IP 키는 유저 키와 다른 네임스페이스다 (`auth/router.py:build_router`).
    ip_statuses = []
    for index in range(61):
        response = ctx.backend.request(
            "POST",
            "/v2/auth/login",
            json={"provider": "google", "id_token": "harness-token-new-actor"},
        )
        ip_statuses.append(response.status)
    ctx.note(
        "ip-window",
        {
            "blocked_at_61": ip_statuses[60] == 429,
            "user_key_unaffected": ctx.backend.request(
                "GET", "/v2/me", headers=other_headers
            ).status,
        },
    )
    ctx.call(
        "ip-blocked",
        "post",
        "/v2/auth/login",
        json={"provider": "google", "id_token": "harness-token-new-actor"},
    )
    ctx.backend.set_client_host("10.0.0.9")
    other_ip = ctx.call(
        "other-ip-not-blocked",
        "post",
        "/v2/auth/login",
        json={"provider": "google", "id_token": "harness-token-second-actor"},
    )
    if other_ip.status == 200:
        ctx.register(other_ip.parsed["user"]["id"], "user")
    ctx.backend.set_client_host("testclient")


# --- 요청 validation 경계 ---------------------------------------------------


def request_validation(ctx) -> None:
    """OpenAPI 에 표현되지 않는 것들."""
    tokens = login(ctx, "login", "harness-token-new-actor")
    headers = {"Authorization": f"Bearer {tokens['access_token']}"}
    grant_all_consents(ctx, "validation", headers)

    # 숫자 파싱: 정수형 float 는 통과, 소수는 422 (/SPEC.md §6 #15)
    integral = ctx.call(
        "size-integral-float",
        "post",
        "/v2/uploads/intents",
        json={"mime_type": "video/mp4", "size_bytes": 12.0, "duration_ms": 1000},
        headers=headers,
    )
    if integral.status == 201:
        ctx.register(integral.parsed["intent_id"], "upload_intent")
    ctx.call(
        "size-fractional",
        "post",
        "/v2/uploads/intents",
        json={"mime_type": "video/mp4", "size_bytes": 12.5, "duration_ms": 1000},
        headers=headers,
    )
    ctx.call(
        "size-zero",
        "post",
        "/v2/uploads/intents",
        json={"mime_type": "video/mp4", "size_bytes": 0},
        headers=headers,
    )
    ctx.call(
        "mime-not-video",
        "post",
        "/v2/uploads/intents",
        json={"mime_type": "image/png", "size_bytes": 12},
        headers=headers,
    )
    ctx.call(
        "too-large",
        "post",
        "/v2/uploads/intents",
        json={"mime_type": "video/mp4", "size_bytes": 100 * 1024 * 1024 + 1},
        headers=headers,
    )

    # blockage_kind × sub_branch 조합
    for name, kind, branch in (
        ("analysis-ok", "분석", "대사 분석"),
        ("analysis-bad", "분석", "감정"),
        ("expression-ok", "표현", "화술"),
        ("expression-bad", "표현", "캐릭터 분석"),
        ("other-ok", "그 외", "그 외"),
        ("other-bad", "그 외", "감정"),
    ):
        ctx.call(
            f"branch.{name}",
            "post",
            "/v2/practice-sessions",
            json={
                "upload_intent_id": MISSING_SESSION_ID,
                "situation": "s",
                "character_context": "c",
                "goal": "g",
                "blockage_kind": kind,
                "sub_branch": branch,
                "blockage_detail": None,
            },
            headers={**headers, "X-Request-Id": ctx.request_id(f"branch-{name}")},
        )
    ctx.call(
        "branch.blank-situation",
        "post",
        "/v2/practice-sessions",
        json={
            "upload_intent_id": MISSING_SESSION_ID,
            "situation": "",
            "character_context": "c",
            "goal": "g",
            "blockage_kind": "분석",
            "sub_branch": "대사 분석",
        },
        headers=headers,
    )

    # CoachConfirmReq — confirmed=false 면 공백 아닌 rebuttal 필수
    for name, payload in (
        ("blank", {"coach_session_id": MISSING_COACH_SESSION_ID, "confirmed": False,
                   "rebuttal_text": "   "}),
        ("null", {"coach_session_id": MISSING_COACH_SESSION_ID, "confirmed": False,
                  "rebuttal_text": None}),
        ("present", {"coach_session_id": MISSING_COACH_SESSION_ID, "confirmed": False,
                     "rebuttal_text": "아니에요"}),
    ):
        ctx.call(
            f"confirm.{name}",
            "post",
            "/v2/coach/confirm",
            json=payload,
            headers={**headers, "X-Request-Id": ctx.request_id(f"confirm-{name}")},
        )

    # 커뮤니티 trim + 길이 경계
    one = ctx.auth(cfg.SEED_USER_IDS[0])
    for name, body in (
        ("title-max", {"category_slug": "free", "title": "가" * 100, "body": "본문"}),
        ("title-over", {"category_slug": "free", "title": "가" * 101, "body": "본문"}),
        ("title-blank", {"category_slug": "free", "title": "   ", "body": "본문"}),
        ("body-blank", {"category_slug": "free", "title": "제목", "body": "  "}),
        ("body-max", {"category_slug": "free", "title": "제목", "body": "나" * 5000}),
        ("body-over", {"category_slug": "free", "title": "제목", "body": "나" * 5001}),
    ):
        step = ctx.call(
            f"post.{name}",
            "post",
            "/v2/community/posts",
            json={**body, "anonymous": False},
            headers=one,
        )
        if step.status == 201:
            ctx.register(step.parsed["id"], "post")

    for name, body in (
        ("comment-max", {"body": "다" * 1000, "anonymous": False}),
        ("comment-over", {"body": "다" * 1001, "anonymous": False}),
        ("comment-blank", {"body": "  ", "anonymous": False}),
    ):
        step = ctx.call(
            f"comment.{name}",
            "post",
            "/v2/community/posts/{post_id}/comments",
            path_params={"post_id": cfg.SEED_POST_IDS[1]},
            json=body,
            headers=one,
        )
        if step.status == 201:
            ctx.register(step.parsed["id"], "comment")

    for name, nickname in (
        ("blank", "   "),
        ("collapse", "  두   칸  "),
        ("too-long", "가" * 21),
        ("max", "가" * 20),
    ):
        ctx.call(
            f"nickname.{name}",
            "patch",
            "/v2/me",
            json={"nickname": nickname},
            headers=one,
        )

    # parse_request_id 가 라우트에서 가장 먼저 도는 곳으로 때린다.
    ctx.call(
        "invalid-request-id",
        "post",
        "/v2/practice-sessions",
        json={
            "upload_intent_id": MISSING_SESSION_ID,
            "situation": "s",
            "character_context": "c",
            "goal": "g",
            "blockage_kind": "분석",
            "sub_branch": "대사 분석",
            "blockage_detail": None,
        },
        headers={**headers, "X-Request-Id": "not-a-uuid"},
    )


# --- unknown key 정책 ------------------------------------------------------

UNKNOWN_KEY = "harness_unknown_key"

# (case, method, template, path_params, body). 기대값은 하드코딩하지 않고
# 실행 시점의 `openapi.json` 에서 만든 허용 집합으로 판정한다(§기대값 소스).
UNKNOWN_KEY_CASES = (
    ("auth-login", "post", "/v2/auth/login", {},
     {"provider": "google", "id_token": "harness-token-new-actor"}),
    ("auth-logout", "post", "/v2/auth/logout", {}, {"refresh_token": "x"}),
    ("auth-refresh", "post", "/v2/auth/refresh", {}, {"refresh_token": "x"}),
    ("consents", "post", "/v2/consents", {},
     {"document_id": cfg.SEED_CONSENT_DOCUMENTS[0][0], "action": "granted"}),
    ("uploads-intents", "post", "/v2/uploads/intents", {},
     {"mime_type": "video/mp4", "size_bytes": 4096, "duration_ms": 1000}),
    ("practice-sessions", "post", "/v2/practice-sessions", {},
     {"upload_intent_id": MISSING_SESSION_ID, "situation": "s",
      "character_context": "c", "goal": "g", "blockage_kind": "분석",
      "sub_branch": "대사 분석"}),
    ("coach-start", "post", "/v2/coach/start", {},
     {"practice_session_id": MISSING_SESSION_ID}),
    ("coach-reply", "post", "/v2/coach/reply", {},
     {"session_id": MISSING_COACH_SESSION_ID, "text": "t"}),
    ("coach-confirm", "post", "/v2/coach/confirm", {},
     {"coach_session_id": MISSING_COACH_SESSION_ID, "confirmed": True}),
    ("reports", "post", "/v2/reports", {}, {"session_id": MISSING_COACH_SESSION_ID}),
    ("me", "patch", "/v2/me", {}, {"nickname": "이름"}),
    ("community-posts", "post", "/v2/community/posts", {},
     {"category_slug": "free", "title": "t", "body": "b", "anonymous": False}),
    ("community-post-patch", "patch", "/v2/community/posts/{post_id}",
     {"post_id": MISSING_POST_ID}, {"title": "t", "body": "b"}),
    ("community-comments", "post", "/v2/community/posts/{post_id}/comments",
     {"post_id": MISSING_POST_ID}, {"body": "b", "anonymous": False}),
    ("community-comment-patch", "patch", "/v2/community/comments/{comment_id}",
     {"comment_id": MISSING_POST_ID}, {"body": "b", "anonymous": False}),
    ("community-reports", "post", "/v2/community/reports", {},
     {"target_type": "post", "target_id": MISSING_POST_ID, "reason": "spam"}),
    ("community-blocks", "post", "/v2/community/blocks", {},
     {"user_id": cfg.SEED_USER_IDS[1]}),
)


def unknown_keys(ctx) -> None:
    """요청 바디 전부에 unknown key 회귀 테스트를 건다 (/SPEC.md §6-3)."""
    headers = ctx.auth(cfg.SEED_USER_IDS[0])
    for case, method, template, path_params, body in UNKNOWN_KEY_CASES:
        step = ctx.call(
            f"unknown.{case}",
            method,
            template,
            path_params=path_params,
            json={**body, UNKNOWN_KEY: "값"},
            headers={**headers, "X-Request-Id": ctx.request_id(f"unknown-{case}")},
        )
        ctx.note(
            f"unknown.{case}.verdict",
            {
                "extra_forbidden": _has_extra_forbidden(step.parsed),
                "status": step.status,
            },
        )
        if step.status in {200, 201} and isinstance(step.parsed, dict):
            for key in ("id", "intent_id", "session_id"):
                if isinstance(step.parsed.get(key), str):
                    ctx.register(step.parsed[key], "unknown_key_artifact")
        if step.status == 200 and isinstance(step.parsed, dict) and "user" in step.parsed:
            ctx.register(step.parsed["user"]["id"], "user")


def _has_extra_forbidden(parsed) -> bool:
    if not isinstance(parsed, dict):
        return False
    detail = parsed.get("detail")
    if not isinstance(detail, list):
        return False
    return any(
        isinstance(item, dict)
        and item.get("type") == "extra_forbidden"
        and UNKNOWN_KEY in (item.get("loc") or [])
        for item in detail
    )
