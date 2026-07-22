from __future__ import annotations

from fastapi import Depends, HTTPException, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from starlette.concurrency import run_in_threadpool

from acting_api.auth.jwt import JwtService, TokenValidationError
from acting_api.ratelimit import RateLimiter

bearer_scheme = HTTPBearer(auto_error=False)


def user_status_value(user) -> str:
    return getattr(user.status, "value", user.status)


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
        if user_status_value(user) == "suspended":
            raise HTTPException(status_code=403, detail="account_suspended")
        return user

    return current_user


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
