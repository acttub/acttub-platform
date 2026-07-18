from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest

from acting_api.auth.jwt import (
    ACCESS_TOKEN_TTL,
    REFRESH_TOKEN_TTL,
    JwtService,
    TokenValidationError,
)


def test_access_and_refresh_token_lifetimes_and_claims():
    now = datetime(2026, 1, 2, 3, 4, 5, tzinfo=timezone.utc)
    user_id = uuid4()
    service = JwtService("secret")

    access = service.issue_access_token(user_id, now=now)
    refresh = service.issue_refresh_token(user_id, now=now)

    assert access.expires_at == now + ACCESS_TOKEN_TTL
    assert refresh.expires_at == now + REFRESH_TOKEN_TTL
    assert service.decode_access_token(access.value, now=now).user_id == user_id
    assert service.decode_refresh_token(refresh.value, now=now).user_id == user_id


def test_expired_and_tampered_tokens_are_rejected():
    now = datetime(2026, 1, 2, 3, 4, 5, tzinfo=timezone.utc)
    service = JwtService("secret")
    token = service.issue_access_token(uuid4(), now=now)

    with pytest.raises(TokenValidationError):
        service.decode_access_token(token.value, now=now + timedelta(minutes=30))

    prefix, payload, signature = token.value.split(".")
    tampered = f"{prefix}.{payload[:-1]}A.{signature}"
    with pytest.raises(TokenValidationError):
        service.decode_access_token(tampered, now=now)

    with pytest.raises(TokenValidationError):
        JwtService("different-secret").decode_access_token(token.value, now=now)


def test_token_type_is_enforced():
    now = datetime(2026, 1, 2, tzinfo=timezone.utc)
    service = JwtService("secret")
    refresh = service.issue_refresh_token(uuid4(), now=now)
    with pytest.raises(TokenValidationError):
        service.decode_access_token(refresh.value, now=now)


def test_malformed_unicode_token_is_rejected():
    with pytest.raises(TokenValidationError):
        JwtService("secret").decode_access_token("é.e.e")
