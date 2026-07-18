from __future__ import annotations

import base64
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import json
from typing import Any
from uuid import UUID, uuid4

ACCESS_TOKEN_TTL = timedelta(minutes=30)
REFRESH_TOKEN_TTL = timedelta(days=14)


class TokenValidationError(ValueError):
    pass


@dataclass(frozen=True)
class IssuedToken:
    value: str
    expires_at: datetime


@dataclass(frozen=True)
class TokenClaims:
    user_id: UUID
    token_id: UUID
    expires_at: datetime


def _b64url_encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _b64url_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    try:
        return base64.b64decode(value + padding, altchars=b"-_", validate=True)
    except (ValueError, TypeError) as exc:
        raise TokenValidationError("invalid token encoding") from exc


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


class JwtService:
    """Minimal JWT implementation restricted to HS256 and this service's claims."""

    def __init__(
        self,
        secret: str,
        *,
        issuer: str = "acting-api",
        audience: str = "acting-app",
    ):
        if not secret:
            raise ValueError("JWT secret must not be empty")
        self._secret = secret.encode("utf-8")
        self._issuer = issuer
        self._audience = audience

    def issue_access_token(
        self, user_id: UUID, *, now: datetime | None = None
    ) -> IssuedToken:
        return self._issue(user_id, "access", ACCESS_TOKEN_TTL, now=now)

    def issue_refresh_token(
        self, user_id: UUID, *, now: datetime | None = None
    ) -> IssuedToken:
        return self._issue(user_id, "refresh", REFRESH_TOKEN_TTL, now=now)

    def decode_access_token(
        self, token: str, *, now: datetime | None = None
    ) -> TokenClaims:
        return self._decode(token, "access", now=now)

    def decode_refresh_token(
        self, token: str, *, now: datetime | None = None
    ) -> TokenClaims:
        return self._decode(token, "refresh", now=now)

    def _issue(
        self,
        user_id: UUID,
        token_type: str,
        ttl: timedelta,
        *,
        now: datetime | None,
    ) -> IssuedToken:
        issued_at = now or _utc_now()
        if issued_at.tzinfo is None:
            raise ValueError("now must be timezone-aware")
        issued_at = issued_at.astimezone(timezone.utc)
        expires_at = issued_at + ttl
        header = {"alg": "HS256", "typ": "JWT"}
        payload = {
            "iss": self._issuer,
            "aud": self._audience,
            "sub": str(user_id),
            "jti": str(uuid4()),
            "token_type": token_type,
            "iat": int(issued_at.timestamp()),
            "exp": int(expires_at.timestamp()),
        }
        encoded_header = self._encode_json(header)
        encoded_payload = self._encode_json(payload)
        signing_input = f"{encoded_header}.{encoded_payload}".encode("ascii")
        signature = hmac.new(self._secret, signing_input, hashlib.sha256).digest()
        return IssuedToken(
            value=f"{signing_input.decode('ascii')}.{_b64url_encode(signature)}",
            expires_at=expires_at,
        )

    @staticmethod
    def _encode_json(value: dict[str, Any]) -> str:
        return _b64url_encode(
            json.dumps(value, separators=(",", ":"), sort_keys=True).encode("utf-8")
        )

    def _decode(
        self, token: str, expected_type: str, *, now: datetime | None
    ) -> TokenClaims:
        try:
            encoded_header, encoded_payload, encoded_signature = token.split(".")
        except ValueError as exc:
            raise TokenValidationError("invalid token structure") from exc

        try:
            signing_input = f"{encoded_header}.{encoded_payload}".encode("ascii")
        except UnicodeEncodeError as exc:
            raise TokenValidationError("invalid token encoding") from exc
        expected_signature = hmac.new(
            self._secret, signing_input, hashlib.sha256
        ).digest()
        signature = _b64url_decode(encoded_signature)
        if not hmac.compare_digest(signature, expected_signature):
            raise TokenValidationError("invalid token signature")

        try:
            header = json.loads(_b64url_decode(encoded_header))
            payload = json.loads(_b64url_decode(encoded_payload))
        except (json.JSONDecodeError, UnicodeDecodeError, TypeError) as exc:
            raise TokenValidationError("invalid token JSON") from exc
        if header != {"alg": "HS256", "typ": "JWT"}:
            raise TokenValidationError("unsupported token header")
        if not isinstance(payload, dict):
            raise TokenValidationError("invalid token claims")

        required = {"iss", "aud", "sub", "jti", "token_type", "iat", "exp"}
        if not required.issubset(payload):
            raise TokenValidationError("missing token claims")
        if payload["iss"] != self._issuer or payload["aud"] != self._audience:
            raise TokenValidationError("invalid token issuer or audience")
        if payload["token_type"] != expected_type:
            raise TokenValidationError("wrong token type")
        if not isinstance(payload["iat"], int) or not isinstance(payload["exp"], int):
            raise TokenValidationError("invalid token timestamps")

        checked_at = now or _utc_now()
        if checked_at.tzinfo is None:
            raise ValueError("now must be timezone-aware")
        checked_timestamp = int(checked_at.astimezone(timezone.utc).timestamp())
        if payload["iat"] > checked_timestamp or payload["exp"] <= checked_timestamp:
            raise TokenValidationError("token is expired or not yet valid")
        try:
            user_id = UUID(payload["sub"])
            token_id = UUID(payload["jti"])
        except (ValueError, TypeError, AttributeError) as exc:
            raise TokenValidationError("invalid token identifiers") from exc
        return TokenClaims(
            user_id=user_id,
            token_id=token_id,
            expires_at=datetime.fromtimestamp(payload["exp"], timezone.utc),
        )
