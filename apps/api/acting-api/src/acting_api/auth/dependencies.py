from __future__ import annotations

from fastapi import Depends, HTTPException, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from starlette.concurrency import run_in_threadpool

from acting_api.auth.jwt import JwtService, TokenValidationError
from acting_api.ratelimit import RateLimiter

bearer_scheme = HTTPBearer(auto_error=False)


def user_status_value(user) -> str:
    return getattr(user.status, "value", user.status)


# 정지와 탈퇴는 다른 코드로 구분한다 — 클라이언트가 띄울 안내가 다르고(문의하세요 /
# 탈퇴한 계정입니다), 되돌리는 주체도 다르다. 아래 네 자리에서 같은 분기가 반복되는데,
# 헬퍼로 접지 않는다: contract-harness 가 소스에서 리터럴 detail 을 긁어 오류 계약
# inventory 를 만든다(tools/contract-harness/contract_harness/inventory.py).
# 변수로 넘기면 계약이 inventory 에서 사라진다.


def build_current_user_dependency(store, jwt_service: JwtService):
    async def current_user(
        credentials: HTTPAuthorizationCredentials | None = Security(bearer_scheme),
    ):
        if credentials is None or credentials.scheme.lower() != "bearer":
            raise HTTPException(status_code=401, detail="invalid or missing access token")
        try:
            claims = jwt_service.decode_access_token(credentials.credentials)
        except TokenValidationError as exc:
            raise HTTPException(
                status_code=401, detail="invalid or missing access token"
            ) from exc
        user = await run_in_threadpool(store.get_user, claims.user_id)
        if user is None:
            raise HTTPException(status_code=401, detail="invalid or missing access token")
        status_value = user_status_value(user)
        if status_value == "suspended":
            raise HTTPException(status_code=403, detail="account_suspended")
        if status_value == "deactivated":
            raise HTTPException(status_code=403, detail="account_deactivated")
        return user

    return current_user


def build_optional_user_dependency(store, jwt_service: JwtService):
    """토큰이 없으면 익명(None)으로 통과시킨다.

    커뮤니티 읽기처럼 가입 전에도 보여야 하는 자리에 쓴다. 토큰이 *있는데* 못 쓰는
    경우는 익명으로 낮추지 않고 401 을 준다 — 그래야 클라이언트가 refresh 를 돌린다.
    조용히 익명으로 떨어뜨리면 로그인한 사람이 자기 글을 남의 글처럼 보게 된다.
    """

    async def optional_user(
        credentials: HTTPAuthorizationCredentials | None = Security(bearer_scheme),
    ):
        if credentials is None:
            return None
        if credentials.scheme.lower() != "bearer":
            raise HTTPException(status_code=401, detail="invalid or missing access token")
        try:
            claims = jwt_service.decode_access_token(credentials.credentials)
        except TokenValidationError as exc:
            raise HTTPException(
                status_code=401, detail="invalid or missing access token"
            ) from exc
        user = await run_in_threadpool(store.get_user, claims.user_id)
        if user is None:
            raise HTTPException(status_code=401, detail="invalid or missing access token")
        status_value = user_status_value(user)
        if status_value == "suspended":
            raise HTTPException(status_code=403, detail="account_suspended")
        if status_value == "deactivated":
            raise HTTPException(status_code=403, detail="account_deactivated")
        return user

    return optional_user


def build_rate_limited_user_dependency(
    current_user,
    limiter: RateLimiter,
    *,
    limit_per_min: int = 60,
):
    async def rate_limited_user(user=Depends(current_user)):
        if not limiter.allow(str(user.id), limit_per_min):
            raise HTTPException(status_code=429, detail="rate limit exceeded")
        return user

    return rate_limited_user


def build_consent_gate_dependency(rate_limited_user, store):
    async def consented_user(user=Depends(rate_limited_user)):
        has_pending = await run_in_threadpool(
            store.has_pending_required_consents, user.id
        )
        if has_pending:
            raise HTTPException(status_code=403, detail="consent_required")
        return user

    return consented_user
