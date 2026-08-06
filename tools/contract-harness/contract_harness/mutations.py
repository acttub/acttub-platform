"""의도적으로 변조한 백엔드 — 하네스가 이것을 못 잡으면 하네스의 결함이다.

변조는 두 갈래다.
- **응답 변조**: ASGI 래퍼에서 응답을 고친다. 백엔드 인스턴스마다 따로 걸린다.
- **동작 변조**: monkeypatch. 두 백엔드가 같은 프로세스 안에 있으므로 해당 백엔드의
  실행 구간에서만 살아 있어야 한다(`backends.py:FastapiBackend.session`).
"""

from __future__ import annotations

import contextlib
import json
from dataclasses import dataclass, field


@dataclass(frozen=True)
class Mutation:
    name: str
    description: str
    scenario: str
    expected_layers: frozenset
    response_hook: object = None
    patch: object = None
    forbidden_layers: frozenset = frozenset()


# --- 응답 변조 도구 --------------------------------------------------------


def _content_type(headers) -> str:
    for key, value in headers:
        if key.lower() == "content-type":
            return value
    return ""


def _encode(value, *, sort_keys=True, ensure_ascii=False, reverse=False) -> bytes:
    if reverse:
        value = _reverse_keys(value)
        return json.dumps(
            value, ensure_ascii=ensure_ascii, separators=(",", ":")
        ).encode("utf-8")
    return json.dumps(
        value, ensure_ascii=ensure_ascii, sort_keys=sort_keys, separators=(",", ":")
    ).encode("utf-8")


def _reverse_keys(value):
    if isinstance(value, dict):
        return {key: _reverse_keys(value[key]) for key in sorted(value, reverse=True)}
    if isinstance(value, list):
        return [_reverse_keys(item) for item in value]
    return value


def json_hook(transform, *, encode=None):
    """JSON 응답에만 걸리는 변조."""

    def hook(scope, status, headers, body):
        if "application/json" not in _content_type(headers) or not body:
            return status, headers, body
        try:
            parsed = json.loads(body)
        except ValueError:
            return status, headers, body
        result = transform(parsed, scope, status)
        if result is None:
            return status, headers, body
        encoder = encode or _encode
        return status, headers, encoder(result)

    return hook


# --- 개별 변조 -------------------------------------------------------------


def _add_field(parsed, scope, status):
    if not isinstance(parsed, dict) or not (200 <= status < 300):
        return None
    return {**parsed, "harness_extra_field": "추가된 필드"}


def _drop_field(parsed, scope, status):
    if scope["path"] != "/v2/me" or not isinstance(parsed, dict):
        return None
    if "nickname" not in parsed:
        return None
    return {key: value for key, value in parsed.items() if key != "nickname"}


def _drop_nulls(value):
    if isinstance(value, dict):
        return {
            key: _drop_nulls(item)
            for key, item in value.items()
            if item is not None
        }
    if isinstance(value, list):
        return [_drop_nulls(item) for item in value]
    return value


def _omit_null_keys(parsed, scope, status):
    if not (200 <= status < 300):
        return None
    return _drop_nulls(parsed)


def _rewrite_datetimes(convert):
    def _walk(value):
        if isinstance(value, dict):
            return {key: _walk(item) for key, item in value.items()}
        if isinstance(value, list):
            return [_walk(item) for item in value]
        if isinstance(value, str):
            return convert(value)
        return value

    def _transform(parsed, scope, status):
        return _walk(parsed)

    return _transform


_DATETIME_TAIL = ("Z", "+00:00")


def _to_offset(value: str) -> str:
    if value.endswith("Z") and "T" in value and len(value) >= 20:
        return value[:-1] + "+00:00"
    return value


def _to_millis(value: str) -> str:
    if "T" not in value:
        return value
    for tail in _DATETIME_TAIL:
        if value.endswith(tail) and "." in value:
            head, _, fraction = value[: -len(tail)].partition(".")
            if fraction.isdigit() and len(fraction) == 6:
                return f"{head}.{fraction[:3]}{tail}"
    return value


def _expires_before_created(parsed, scope, status):
    if not isinstance(parsed, dict) or "expires_at" not in parsed:
        return None
    return {**parsed, "expires_at": "2020-01-01T00:00:00.000000+00:00"}


def _uppercase_enum(parsed, scope, status):
    if scope["path"] != "/v2/me" or not isinstance(parsed, dict):
        return None
    value = parsed.get("status")
    if not isinstance(value, str):
        return None
    return {**parsed, "status": value.upper()}


class _ReplayKeyOrder:
    """replay 쪽 응답만 키 순서를 바꾼다 — L3-a 가 잡아야 한다."""

    def __init__(self) -> None:
        self.seen: set[tuple[str, str]] = set()

    def __call__(self, scope, status, headers, body):
        if "application/json" not in _content_type(headers) or not body:
            return status, headers, body
        request_id = None
        for key, value in headers:
            if key.lower() == "x-request-id":
                request_id = value
        if request_id is None:
            return status, headers, body
        marker = (request_id, scope["path"])
        if marker not in self.seen:
            self.seen.add(marker)
            return status, headers, body
        try:
            parsed = json.loads(body)
        except ValueError:
            return status, headers, body
        return status, headers, _encode(parsed, reverse=True)


def _always_unsorted(scope, status, headers, body):
    if "application/json" not in _content_type(headers) or not body:
        return status, headers, body
    try:
        parsed = json.loads(body)
    except ValueError:
        return status, headers, body
    return status, headers, _encode(parsed, reverse=True)


def _ascii_escape(scope, status, headers, body):
    if "application/json" not in _content_type(headers) or not body:
        return status, headers, body
    try:
        parsed = json.loads(body)
    except ValueError:
        return status, headers, body
    return status, headers, _encode(parsed, ensure_ascii=True)


def _detail_rewriter(mapping):
    def _transform(parsed, scope, status):
        if not isinstance(parsed, dict):
            return None
        detail = parsed.get("detail")
        if not isinstance(detail, str) or detail not in mapping:
            return None
        return {**parsed, "detail": mapping[detail]}

    return _transform


def _strip_request_id(scope, status, headers, body):
    return status, [item for item in headers if item[0].lower() != "x-request-id"], body


def _reverse_turns(parsed, scope, status):
    if not isinstance(parsed, dict) or not isinstance(parsed.get("turns"), list):
        return None
    return {**parsed, "turns": list(reversed(parsed["turns"]))}


# --- 동작 변조 (monkeypatch) ------------------------------------------------


@contextlib.contextmanager
def patch_attr(target, name, value):
    sentinel = object()
    previous = getattr(target, name, sentinel)
    setattr(target, name, value)
    try:
        yield
    finally:
        if previous is sentinel:
            delattr(target, name)
        else:
            setattr(target, name, previous)


def _patch_reverse_post_order():
    from acting_api.db.community_store import CommunityStore, Page

    original = CommunityStore.list_posts

    def patched(self, **kwargs):
        page = original(self, **kwargs)
        return Page(items=list(reversed(page.items)), next_cursor=page.next_cursor)

    return patch_attr(CommunityStore, "list_posts", patched)


def _patch_cursor_overlap():
    from acting_api.db.community_store import CommunityStore

    original = CommunityStore.list_posts

    def patched(self, **kwargs):
        kwargs["cursor"] = None
        return original(self, **kwargs)

    return patch_attr(CommunityStore, "list_posts", patched)


def _patch_view_count_after_increment():
    import dataclasses

    from acting_api.db.community_store import CommunityStore

    original = CommunityStore.get_post

    def patched(self, post_id, *, viewer_id=None):
        post = original(self, post_id, viewer_id=viewer_id)
        return dataclasses.replace(post, view_count=post.view_count + 1)

    return patch_attr(CommunityStore, "get_post", patched)


def _patch_resume_disabled():
    from acting_api.db.store import PostgresStore

    def patched(self, **kwargs):
        return None

    return patch_attr(PostgresStore, "get_oldest_open_coach_session", patched)


def _patch_release_rewinds():
    from sqlalchemy import text

    from acting_api.db.store import PostgresStore

    original = PostgresStore.release_external_operation

    def patched(self, **kwargs):
        result = original(self, **kwargs)
        with self.engine.begin() as connection:
            connection.execute(
                text(
                    "UPDATE external_operations SET attempt_count ="
                    " GREATEST(attempt_count - 1, 0) WHERE id = :id"
                ),
                {"id": kwargs["operation_id"]},
            )
        return result

    return patch_attr(PostgresStore, "release_external_operation", patched)


def _patch_sweep_missing():
    from acting_api.db.store import PostgresStore

    def patched(self, **kwargs):
        return 0

    return patch_attr(PostgresStore, "sweep_max_attempts_operations", patched)


def _patch_transient_is_fatal():
    from acting_api import analysis_worker

    return patch_attr(
        analysis_worker, "analysis_error_code", lambda exc: "gemini_timeout"
    )


def _patch_nonatomic_like():
    """원자 upsert + 재집계를 SELECT-then-INSERT + read-modify-write 로 바꾼다.

    읽기와 쓰기 사이에 짧은 지연을 둔다 — 잘못된 구현을 **결정적으로** 잘못되게
    만들기 위해서다. 지연이 없으면 두 트랜잭션이 실제로 겹치는지가 스케줄러에
    좌우돼 self-test 가 흔들린다.
    """
    import time
    from uuid import uuid4

    from sqlalchemy import select

    from acting_api.db.community_store import CommunityStore, PostNotFound
    from acting_api.db.models import CommunityPost, CommunityPostLike, ContentStatus

    def patched(self, *, post_id, user_id):
        with self._session_factory.begin() as db:
            post = db.get(CommunityPost, post_id)
            if post is None or post.status != ContentStatus.VISIBLE:
                raise PostNotFound(post_id)
            existing = db.scalar(
                select(CommunityPostLike.id).where(
                    CommunityPostLike.post_id == post_id,
                    CommunityPostLike.user_id == user_id,
                )
            )
            current = post.like_count
            time.sleep(0.2)
            if existing is None:
                db.add(
                    CommunityPostLike(id=uuid4(), post_id=post_id, user_id=user_id)
                )
                post.like_count = current + 1
            db.flush()
            return post.like_count

    return patch_attr(CommunityStore, "like_post", patched)


def _patch_no_rate_limiter():
    from acting_api.ratelimit import RateLimiter

    return patch_attr(RateLimiter, "allow", lambda self, key, limit_per_min: True)


def _patch_jwt_kid_allowed():
    from acting_api.auth import jwt as jwt_module

    original = jwt_module.JwtService._decode

    def patched(self, token, expected_type, *, now=None):
        parts = token.split(".")
        if len(parts) == 3:
            try:
                header = json.loads(jwt_module._b64url_decode(parts[0]))
            except Exception:  # noqa: BLE001 - 원본 경로로 넘긴다
                header = None
            if isinstance(header, dict) and "kid" in header:
                stripped = {
                    key: value for key, value in header.items() if key != "kid"
                }
                rebuilt = jwt_module._b64url_encode(
                    json.dumps(stripped, separators=(",", ":"), sort_keys=True).encode()
                )
                token = ".".join([rebuilt, parts[1], parts[2]])
                # 서명을 다시 계산해 원본 디코더가 통과시키게 만든다.
                import hashlib
                import hmac

                signing_input = f"{rebuilt}.{parts[1]}".encode("ascii")
                signature = hmac.new(
                    self._secret, signing_input, hashlib.sha256
                ).digest()
                token = f"{signing_input.decode('ascii')}.{jwt_module._b64url_encode(signature)}"
        return original(self, token, expected_type, now=now)

    return patch_attr(jwt_module.JwtService, "_decode", patched)


def _patch_refresh_revokes_only_session():
    """소진 토큰 재사용 시 **해당 세션만** revoke 한다(전 세션 무효화를 뺀다).

    전 세션 무효화는 `rotate_refresh_token` 안에 인라인으로 들어 있으므로
    그 메서드 자체를 갈아끼운다.
    """
    from datetime import datetime, timezone
    from uuid import uuid4

    from sqlalchemy import select, update

    from acting_api.db.models import RefreshToken
    from acting_api.db.store import PostgresStore, RefreshTokenRotation

    def patched(
        self,
        *,
        token_hash,
        new_token_hash,
        expires_at,
        device_info=None,
        now=None,
    ):
        now = now or datetime.now(timezone.utc)
        with self._session_factory.begin() as db:
            current = db.scalar(
                select(RefreshToken)
                .where(RefreshToken.token_hash == token_hash)
                .with_for_update()
            )
            if current is None:
                return RefreshTokenRotation(None, False)
            if current.replaced_by_id is not None:
                db.execute(
                    update(RefreshToken)
                    .where(
                        RefreshToken.id == current.id,
                        RefreshToken.revoked_at.is_(None),
                    )
                    .values(revoked_at=now)
                )
                return RefreshTokenRotation(None, True)
            if current.revoked_at is not None or current.expires_at <= now:
                if current.revoked_at is None:
                    current.revoked_at = now
                return RefreshTokenRotation(None, False)
            replacement = RefreshToken(
                id=uuid4(),
                user_id=current.user_id,
                token_hash=new_token_hash,
                device_info=(
                    device_info if device_info is not None else current.device_info
                ),
                issued_at=now,
                expires_at=expires_at,
            )
            db.add(replacement)
            db.flush()
            current.replaced_by_id = replacement.id
            current.revoked_at = now
            return RefreshTokenRotation(replacement, False)

    return patch_attr(PostgresStore, "rotate_refresh_token", patched)


def _patch_consent_gate_everywhere():
    from acting_api import app as app_module

    original_rate_limited = app_module.build_rate_limited_user_dependency
    original_optional = app_module.build_optional_user_dependency
    gate = app_module.build_consent_gate_dependency
    stack = contextlib.ExitStack()

    holder: dict = {}

    def rate_limited(current_user, limiter, **kwargs):
        dependency = original_rate_limited(current_user, limiter, **kwargs)
        store = holder.get("store")
        if store is None:
            return dependency
        return gate(dependency, store)

    def optional(store, jwt_service):
        dependency = original_optional(store, jwt_service)
        holder["store"] = store

        async def gated(user=None):
            return user

        from fastapi import Depends, HTTPException
        from starlette.concurrency import run_in_threadpool

        async def gated_optional(user=Depends(dependency)):
            if user is None:
                raise HTTPException(status_code=403, detail="consent_required")
            if await run_in_threadpool(store.has_pending_required_consents, user.id):
                raise HTTPException(status_code=403, detail="consent_required")
            return user

        _ = gated
        return gated_optional

    stack.enter_context(
        patch_attr(app_module, "build_optional_user_dependency", optional)
    )
    stack.enter_context(
        patch_attr(app_module, "build_rate_limited_user_dependency", rate_limited)
    )
    return stack


def _patch_admin_prefix():
    from fastapi import APIRouter

    from acting_api import admin as admin_module
    from acting_api import app as app_module

    original = admin_module.build_router

    def patched(**kwargs):
        router = original(**kwargs)
        if router is None:
            return None
        rewritten = APIRouter(prefix="/admin", tags=["admin"])
        for route in router.routes:
            route.path = route.path.replace("/v2/admin", "/admin", 1)
            route.path_format = route.path_format.replace("/v2/admin", "/admin", 1)
            rewritten.routes.append(route)
        return rewritten

    return patch_attr(app_module, "build_admin_router", patched)


# --- 목록 -----------------------------------------------------------------

MUTATIONS: tuple[Mutation, ...] = (
    Mutation(
        "field-added", "응답에 필드 하나를 추가한다", "main-flow",
        frozenset({"L1"}), response_hook=json_hook(_add_field),
    ),
    Mutation(
        "field-removed", "/v2/me 응답에서 nickname 을 뺀다", "profile",
        frozenset({"L1"}), response_hook=json_hook(_drop_field),
    ),
    Mutation(
        "null-key-omitted", "null 필드를 키째 생략한다", "main-flow",
        frozenset({"L2"}), response_hook=json_hook(_omit_null_keys),
    ),
    Mutation(
        "datetime-offset", "datetime 을 +00:00 으로 되돌린다", "community",
        frozenset({"datetime"}),
        response_hook=json_hook(_rewrite_datetimes(_to_offset)),
    ),
    Mutation(
        "datetime-millis", "datetime 소수 자릿수를 3자리로 줄인다", "community",
        frozenset({"datetime"}),
        response_hook=json_hook(_rewrite_datetimes(_to_millis)),
    ),
    Mutation(
        "expires-before-created", "expires_at 을 created_at 보다 앞서게 한다",
        "main-flow", frozenset({"datetime"}),
        response_hook=json_hook(_expires_before_created),
    ),
    Mutation(
        "enum-uppercase", "enum 값을 대문자로 바꾼다", "profile",
        frozenset({"L2"}), response_hook=json_hook(_uppercase_enum),
    ),
    Mutation(
        "replay-key-order", "멱등 replay 의 키 순서만 바꾼다", "main-flow",
        frozenset({"L3-a"}), response_hook=_ReplayKeyOrder(),
    ),
    Mutation(
        "unsorted-keys-always",
        "최초 응답과 replay 양쪽 모두 키를 정렬하지 않는다", "main-flow",
        frozenset({"L3-b"}), response_hook=_always_unsorted,
        forbidden_layers=frozenset({"L3-a"}),
    ),
    Mutation(
        "ascii-escape", "한글을 \\uXXXX 로 escape 한다", "main-flow",
        frozenset({"L3-b"}), response_hook=_ascii_escape,
        forbidden_layers=frozenset({"L3-a"}),
    ),
    Mutation(
        "error-detail-changed", "오류 detail 문자열을 바꾼다", "error-manifest",
        frozenset({"manifest"}),
        response_hook=json_hook(_detail_rewriter({"post_not_found": "post_missing"})),
    ),
    Mutation(
        "error-detail-404-swap",
        "404 두 표기를 서로 바꿔치기한다", "error-manifest",
        frozenset({"manifest"}),
        response_hook=json_hook(
            _detail_rewriter(
                {
                    "practice session not found": "practice_session_not_found",
                    "practice_session_not_found": "practice session not found",
                }
            )
        ),
    ),
    Mutation(
        "missing-request-id", "X-Request-Id 응답 헤더를 누락한다", "main-flow",
        frozenset({"header"}), response_hook=_strip_request_id,
    ),
    Mutation(
        "cursor-direction", "커뮤니티 커서 방향을 뒤집는다", "community-traversal",
        frozenset({"L2"}), patch=_patch_reverse_post_order,
    ),
    Mutation(
        "view-count-after", "조회수를 증가 후 값으로 반환한다", "community",
        frozenset({"L2"}), patch=_patch_view_count_after_increment,
    ),
    Mutation(
        "resume-after-replay",
        "resume 분기를 멱등 replay 뒤로 옮긴다(열린 세션을 못 찾게 한다)",
        "coach-resume", frozenset({"L2", "scenario", "sequence"}), patch=_patch_resume_disabled,
    ),
    Mutation(
        "turns-reversed", "turns 배열을 역순으로 반환한다", "coach-resume",
        frozenset({"L2"}), response_hook=json_hook(_reverse_turns),
    ),
    Mutation(
        "cursor-overlap", "cursor 를 매 요청 새로 발급해 페이지가 겹치게 한다",
        "community-traversal", frozenset({"L2", "scenario", "sequence"}),
        patch=_patch_cursor_overlap,
    ),
    Mutation(
        "release-rewinds-attempts", "release 시 attempt_count 를 되감는다",
        "worker-failure", frozenset({"L2", "scenario", "sequence"}), patch=_patch_release_rewinds,
    ),
    Mutation(
        "sweep-missing", "sweep 을 구현하지 않는다", "worker-failure",
        frozenset({"L2", "scenario", "sequence"}), patch=_patch_sweep_missing,
    ),
    Mutation(
        "transient-is-fatal", "transient 오류를 즉시 failed 로 처리한다",
        "worker-failure", frozenset({"L2", "scenario", "sequence"}), patch=_patch_transient_is_fatal,
    ),
    Mutation(
        "nonatomic-like",
        "원자 연산을 SELECT-then-INSERT / read-modify-write 로 교체한다",
        "concurrency", frozenset({"L2", "scenario", "sequence"}), patch=_patch_nonatomic_like,
    ),
    Mutation(
        "no-rate-limiter", "rate limiter 를 구현하지 않는다", "rate-limiter",
        frozenset({"L2", "status", "scenario", "sequence"}), patch=_patch_no_rate_limiter,
    ),
    Mutation(
        "jwt-kid-allowed", "JWT header 에 kid 가 있어도 허용한다", "token-corpus",
        frozenset({"status", "L2"}), patch=_patch_jwt_kid_allowed,
    ),
    Mutation(
        "refresh-revokes-one",
        "refresh 재사용 시 해당 세션만 revoke 한다", "refresh-rotation",
        frozenset({"L2", "status"}), patch=_patch_refresh_revokes_only_session,
    ),
    Mutation(
        "consent-gate-everywhere",
        "consent gate 를 전 라우트에 적용한다", "consent-gate",
        frozenset({"L2", "status", "scenario", "sequence"}), patch=_patch_consent_gate_everywhere,
    ),
    Mutation(
        "admin-path-prefix", "admin 경로를 /admin/* 로 노출한다", "admin",
        frozenset({"admin-snapshot"}), patch=_patch_admin_prefix,
    ),
)

BY_NAME = {mutation.name: mutation for mutation in MUTATIONS}

_ = field
