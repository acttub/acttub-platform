import pytest

from acting_api.auth.google import GoogleProviderVerifier
from acting_api.auth.providers import InvalidIdentityToken, ProviderConfigurationError


def test_google_verifier_passes_client_id_as_audience_and_extracts_claims(monkeypatch):
    captured = {}

    def fake_verify(token, request, audience):
        captured.update(token=token, request=request, audience=audience)
        return {
            "sub": "google-user",
            "email": "user@example.com",
            "email_verified": True,
        }

    monkeypatch.setattr(
        "acting_api.auth.google.google_id_token.verify_oauth2_token", fake_verify
    )
    identity = GoogleProviderVerifier("client-id").verify("id-token")
    assert captured["token"] == "id-token"
    assert captured["audience"] == "client-id"
    assert identity.provider_uid == "google-user"
    assert identity.email == "user@example.com"
    assert identity.email_verified is True


def test_google_verifier_defers_missing_client_id_until_login_attempt():
    verifier = GoogleProviderVerifier(None)
    with pytest.raises(ProviderConfigurationError, match="GOOGLE_OAUTH_CLIENT_ID"):
        verifier.verify("id-token")


def test_google_verifier_maps_signature_or_claim_failure_to_invalid_token(monkeypatch):
    def reject(*args, **kwargs):
        raise ValueError("bad signature, issuer, audience, or expiry")

    monkeypatch.setattr(
        "acting_api.auth.google.google_id_token.verify_oauth2_token", reject
    )
    with pytest.raises(InvalidIdentityToken):
        GoogleProviderVerifier("client-id").verify("id-token")
