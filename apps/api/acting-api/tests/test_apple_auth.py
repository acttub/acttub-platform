import pytest

from acting_api.auth.apple import AppleProviderVerifier
from acting_api.auth.providers import InvalidIdentityToken, ProviderConfigurationError


class _FakeKey:
    key = "signing-key"


class _FakeJwksClient:
    def __init__(self):
        self.seen_token = None

    def get_signing_key_from_jwt(self, token):
        self.seen_token = token
        return _FakeKey()


def _verifier(client_id="com.acttub.app"):
    return AppleProviderVerifier(client_id, jwks_client=_FakeJwksClient())


def test_apple_verifier_validates_audience_issuer_and_extracts_claims(monkeypatch):
    captured = {}

    def fake_decode(token, key, *, algorithms, audience, issuer):
        captured.update(
            token=token, key=key, algorithms=algorithms, audience=audience, issuer=issuer
        )
        return {"sub": "apple-user", "email": "user@privaterelay.appleid.com",
                "email_verified": "true"}

    monkeypatch.setattr("acting_api.auth.apple.jwt.decode", fake_decode)
    identity = _verifier().verify("id-token")

    assert captured["token"] == "id-token"
    assert captured["key"] == "signing-key"
    assert captured["algorithms"] == ["RS256"]
    assert captured["audience"] == ["com.acttub.app"]
    assert captured["issuer"] == "https://appleid.apple.com"
    assert identity.provider_uid == "apple-user"
    assert identity.email == "user@privaterelay.appleid.com"
    assert identity.email_verified is True


def test_apple_verifier_supports_multiple_audiences(monkeypatch):
    captured = {}

    def fake_decode(token, key, *, algorithms, audience, issuer):
        captured["audience"] = audience
        return {"sub": "u"}

    monkeypatch.setattr("acting_api.auth.apple.jwt.decode", fake_decode)
    AppleProviderVerifier(
        "com.acttub.app, com.acttub.service", jwks_client=_FakeJwksClient()
    ).verify("id-token")
    assert captured["audience"] == ["com.acttub.app", "com.acttub.service"]


def test_apple_verifier_defers_missing_client_id_until_login_attempt():
    verifier = AppleProviderVerifier(None)
    with pytest.raises(ProviderConfigurationError, match="APPLE_OAUTH_CLIENT_ID"):
        verifier.verify("id-token")


def test_apple_verifier_maps_signature_or_claim_failure_to_invalid_token(monkeypatch):
    def reject(*args, **kwargs):
        raise ValueError("bad signature, issuer, audience, or expiry")

    monkeypatch.setattr("acting_api.auth.apple.jwt.decode", reject)
    with pytest.raises(InvalidIdentityToken):
        _verifier().verify("id-token")


def test_apple_verifier_rejects_token_without_sub(monkeypatch):
    monkeypatch.setattr("acting_api.auth.apple.jwt.decode", lambda *a, **k: {"email": "x@y.z"})
    with pytest.raises(InvalidIdentityToken, match="missing sub"):
        _verifier().verify("id-token")
