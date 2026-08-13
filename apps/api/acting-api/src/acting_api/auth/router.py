from __future__ import annotations

import unicodedata
from datetime import datetime, timezone
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, ConfigDict, ValidationError, field_validator
from sqlalchemy.exc import IntegrityError
from starlette.concurrency import run_in_threadpool

from acting_api.auth.dependencies import user_status_value
from acting_api.auth.jwt import ACCESS_TOKEN_TTL, JwtService, TokenValidationError
from acting_api.auth.providers import (
    InvalidIdentityToken,
    ProviderConfigurationError,
    ProviderRegistry,
    UnsupportedProviderError,
)
from acting_api.consents import (
    ConsentDocument,
    consent_document_payload,
    pending_required_documents,
)
from acting_api.db.store import IdentityAlreadyLinkedError
from acting_api.ratelimit import RateLimiter
from acting_api.security import hash_token


class _StrictResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")


class AuthUser(_StrictResponse):
    id: UUID
    email: str | None
    # suspended·deactivated 는 로그인 자체가 403 이라 실제로는 active 만 실린다.
    # 그래도 DB 가 가질 수 있는 값은 계약도 받아야 한다 — Literal 을 좁히면 계약을
    # 어기는 순간 응답 검증 실패로 500 이 난다.
    status: Literal["active", "suspended", "deactivated"]


class TokenPairResponse(_StrictResponse):
    access_token: str
    refresh_token: str
    token_type: str
    expires_in: int
    user: AuthUser
    pending_consents: list[ConsentDocument]


class RefreshTokenResponse(_StrictResponse):
    access_token: str
    refresh_token: str
    token_type: str
    expires_in: int


class SignupAttribution(BaseModel):
    model_config = ConfigDict(extra="ignore")

    utm_source: str | None = None
    utm_medium: str | None = None
    utm_campaign: str | None = None
    utm_id: str | None = None
    utm_content: str | None = None
    utm_term: str | None = None
    referrer_host: str | None = None
    landing_path: str | None = None
    first_seen_at: datetime | None = None

    @field_validator(
        "utm_source",
        "utm_medium",
        "utm_campaign",
        "utm_id",
        "utm_content",
        "utm_term",
        "referrer_host",
        "landing_path",
        mode="before",
    )
    @classmethod
    def sanitize_string(cls, value):
        if value is None:
            return None
        if not isinstance(value, str):
            return None
        cleaned = "".join(
            character
            for character in value
            if unicodedata.category(character) != "Cc"
        ).strip()
        return cleaned[:255] or None


class LoginRequest(BaseModel):
    provider: str
    id_token: str
    signup_attribution: SignupAttribution | None = None

    @field_validator("signup_attribution", mode="before")
    @classmethod
    def discard_invalid_attribution(cls, value):
        if value is None:
            return None
        if not isinstance(value, (dict, SignupAttribution)):
            return None
        if isinstance(value, dict):
            string_fields = (
                "utm_source",
                "utm_medium",
                "utm_campaign",
                "utm_id",
                "utm_content",
                "utm_term",
                "referrer_host",
                "landing_path",
            )
            if any(
                field in value
                and value[field] is not None
                and not isinstance(value[field], str)
                for field in string_fields
            ):
                return None
            if (
                "first_seen_at" in value
                and value["first_seen_at"] is not None
                and not isinstance(value["first_seen_at"], str)
            ):
                return None
        try:
            attribution = SignupAttribution.model_validate(value)
        except (ValidationError, TypeError, ValueError):
            # 유입 정보는 부가 데이터다. 잘못됐다고 인증 자체를 422로 막지 않는다.
            return None
        if (
            attribution.first_seen_at is not None
            and attribution.first_seen_at.tzinfo is None
        ):
            return None
        return attribution


class RefreshRequest(BaseModel):
    refresh_token: str


class LogoutRequest(BaseModel):
    refresh_token: str


def _normalize_email(email: str | None) -> str | None:
    if email is None:
        return None
    normalized = email.strip().lower()
    return normalized or None


def _device_info(request: Request) -> str | None:
    return request.headers.get("user-agent")


def _user_payload(user) -> dict:
    return {
        "id": str(user.id),
        "email": user.email,
        "status": user_status_value(user),
    }


async def _pending_consents(store, user_id) -> list[dict]:
    documents = await run_in_threadpool(
        pending_required_documents, store, user_id
    )
    return [
        consent_document_payload(document)
        for document in documents
    ]


async def _issue_token_pair(
    store,
    jwt_service: JwtService,
    user,
    *,
    device_info: str | None,
) -> dict:
    access = jwt_service.issue_access_token(user.id)
    refresh = jwt_service.issue_refresh_token(user.id)
    await run_in_threadpool(
        store.issue_refresh_token,
        user_id=user.id,
        token_hash=hash_token(refresh.value),
        expires_at=refresh.expires_at,
        device_info=device_info,
    )
    return {
        "access_token": access.value,
        "refresh_token": refresh.value,
        "token_type": "bearer",
        "expires_in": int(ACCESS_TOKEN_TTL.total_seconds()),
        "user": _user_payload(user),
        "pending_consents": await _pending_consents(store, user.id),
    }


def build_router(
    *,
    store,
    jwt_service: JwtService,
    providers: ProviderRegistry,
    current_user,
    user_limiter: RateLimiter,
    user_rate_limit_per_min: int = 60,
) -> APIRouter:
    router = APIRouter(prefix="/v2/auth", tags=["v2-auth"])

    def enforce_rate_limit(user) -> None:
        if not user_limiter.allow(str(user.id), user_rate_limit_per_min):
            raise HTTPException(status_code=429, detail="rate limit exceeded")

    def enforce_ip_rate_limit(request: Request) -> None:
        client_host = (
            request.client.host if request.client is not None else "unknown"
        )
        if not user_limiter.allow(
            f"auth-ip:{client_host}", user_rate_limit_per_min
        ):
            raise HTTPException(status_code=429, detail="rate limit exceeded")

    @router.post(
        "/login",
        responses={status.HTTP_200_OK: {"model": TokenPairResponse}},
    )
    async def login(payload: LoginRequest, request: Request):
        enforce_ip_rate_limit(request)
        provider = payload.provider.strip().lower()
        try:
            identity = await run_in_threadpool(
                providers.verify, provider, payload.id_token
            )
        except UnsupportedProviderError as exc:
            raise HTTPException(status_code=400, detail="unsupported_provider") from exc
        except ProviderConfigurationError as exc:
            raise HTTPException(
                status_code=503, detail="provider_not_configured"
            ) from exc
        except InvalidIdentityToken as exc:
            raise HTTPException(status_code=401, detail="invalid_provider_token") from exc

        user = await run_in_threadpool(
            store.get_user_by_identity, provider, identity.provider_uid
        )
        if user is None:
            email = _normalize_email(identity.email)
            existing = (
                await run_in_threadpool(store.get_user_by_email, email)
                if email is not None
                else None
            )
            try:
                if existing is not None:
                    if not identity.email_verified:
                        raise HTTPException(
                            status_code=409,
                            detail="account_exists_with_different_provider",
                        )
                    await run_in_threadpool(
                        store.link_user_identity,
                        user_id=existing.id,
                        provider=provider,
                        provider_uid=identity.provider_uid,
                    )
                    user = existing
                else:
                    user, _ = await run_in_threadpool(
                        store.create_user_with_identity,
                        provider=provider,
                        provider_uid=identity.provider_uid,
                        email=email if identity.email_verified else None,
                        signup_utm_source=(
                            payload.signup_attribution.utm_source
                            if payload.signup_attribution
                            else None
                        ),
                        signup_utm_medium=(
                            payload.signup_attribution.utm_medium
                            if payload.signup_attribution
                            else None
                        ),
                        signup_utm_campaign=(
                            payload.signup_attribution.utm_campaign
                            if payload.signup_attribution
                            else None
                        ),
                        signup_utm_id=(
                            payload.signup_attribution.utm_id
                            if payload.signup_attribution
                            else None
                        ),
                        signup_utm_content=(
                            payload.signup_attribution.utm_content
                            if payload.signup_attribution
                            else None
                        ),
                        signup_utm_term=(
                            payload.signup_attribution.utm_term
                            if payload.signup_attribution
                            else None
                        ),
                        signup_referrer_host=(
                            payload.signup_attribution.referrer_host
                            if payload.signup_attribution
                            else None
                        ),
                        signup_landing_path=(
                            payload.signup_attribution.landing_path
                            if payload.signup_attribution
                            else None
                        ),
                        signup_first_seen_at=(
                            payload.signup_attribution.first_seen_at
                            if payload.signup_attribution
                            else None
                        ),
                    )
            except (IntegrityError, IdentityAlreadyLinkedError):
                user = await run_in_threadpool(
                    store.get_user_by_identity,
                    provider,
                    identity.provider_uid,
                )
                if user is None:
                    raise

        status_value = user_status_value(user)
        if status_value == "suspended":
            raise HTTPException(status_code=403, detail="account_suspended")
        if status_value == "deactivated":
            raise HTTPException(status_code=403, detail="account_deactivated")
        enforce_rate_limit(user)
        return await _issue_token_pair(
            store,
            jwt_service,
            user,
            device_info=_device_info(request),
        )

    @router.post(
        "/refresh",
        responses={status.HTTP_200_OK: {"model": RefreshTokenResponse}},
    )
    async def refresh(payload: RefreshRequest, request: Request):
        enforce_ip_rate_limit(request)
        now = datetime.now(timezone.utc)
        try:
            claims = jwt_service.decode_refresh_token(payload.refresh_token, now=now)
        except TokenValidationError as exc:
            raise HTTPException(status_code=401, detail="invalid_refresh_token") from exc
        old_hash = hash_token(payload.refresh_token)
        existing = await run_in_threadpool(store.get_refresh_token, old_hash)
        if existing is None or existing.user_id != claims.user_id:
            raise HTTPException(status_code=401, detail="invalid_refresh_token")
        user = await run_in_threadpool(store.get_user, claims.user_id)
        if user is None:
            raise HTTPException(status_code=401, detail="invalid_refresh_token")
        status_value = user_status_value(user)
        if status_value == "suspended":
            raise HTTPException(status_code=403, detail="account_suspended")
        if status_value == "deactivated":
            raise HTTPException(status_code=403, detail="account_deactivated")
        enforce_rate_limit(user)

        access = jwt_service.issue_access_token(user.id, now=now)
        replacement = jwt_service.issue_refresh_token(user.id, now=now)
        rotation = await run_in_threadpool(
            store.rotate_refresh_token,
            token_hash=old_hash,
            new_token_hash=hash_token(replacement.value),
            expires_at=replacement.expires_at,
            device_info=_device_info(request),
            now=now,
        )
        if rotation.reused_rotated_token or rotation.token is None:
            raise HTTPException(status_code=401, detail="invalid_refresh_token")
        return {
            "access_token": access.value,
            "refresh_token": replacement.value,
            "token_type": "bearer",
            "expires_in": int(ACCESS_TOKEN_TTL.total_seconds()),
        }

    @router.post(
        "/logout",
        status_code=status.HTTP_204_NO_CONTENT,
        responses={
            status.HTTP_204_NO_CONTENT: {"description": "No Content"},
        },
    )
    async def logout(payload: LogoutRequest, user=Depends(current_user)):
        enforce_rate_limit(user)
        try:
            claims = jwt_service.decode_refresh_token(payload.refresh_token)
        except TokenValidationError as exc:
            raise HTTPException(status_code=401, detail="invalid_refresh_token") from exc
        token_hash = hash_token(payload.refresh_token)
        stored = await run_in_threadpool(store.get_refresh_token, token_hash)
        if (
            claims.user_id != user.id
            or stored is None
            or stored.user_id != user.id
            or not await run_in_threadpool(store.revoke_refresh_token, token_hash)
        ):
            raise HTTPException(status_code=401, detail="invalid_refresh_token")
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    return router
