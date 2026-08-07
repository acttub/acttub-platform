from __future__ import annotations

import importlib

import pytest
from fastapi.testclient import TestClient

from acting_api.app import create_app
from acting_api.auth.providers import InvalidIdentityToken
from acting_api.config import GatewaySettings
from acting_summary.config import Settings as SummarySettings
from api_test_support import FakeClient
from auth_test_support import FakeAuthStore


def _verifier():
    try:
        module = importlib.import_module("acting_api.auth.development")
    except ModuleNotFoundError:
        pytest.fail("acting_api.auth.development is missing")
    return module.DevelopmentProviderVerifier()


def _app(*, enabled: bool, store: FakeAuthStore | None = None):
    store = store or FakeAuthStore()
    app = create_app(
        client=FakeClient(),
        gateway_settings=GatewaySettings(
            database_url="postgresql+psycopg://unused/unused",
            jwt_secret="development-auth-test-secret",
            development_auth_provider=enabled,
        ),
        summary_settings=SummarySettings(api_key="k", model="m"),
        store=store,
    )
    return app, store


def test_development_verifier_uses_token_as_uid_without_email():
    identity = _verifier().verify("local-user")

    assert identity.provider_uid == "local-user"
    assert identity.email is None
    assert identity.email_verified is False


def test_development_verifier_parses_unverified_email_form():
    identity = _verifier().verify("local-user:actor@example.com")

    assert identity.provider_uid == "local-user"
    assert identity.email == "actor@example.com"
    assert identity.email_verified is False


@pytest.mark.parametrize("token", ["", "   "])
def test_development_verifier_rejects_empty_or_whitespace_token(token):
    with pytest.raises(InvalidIdentityToken):
        _verifier().verify(token)


def test_development_provider_is_unsupported_when_flag_is_off():
    app, _ = _app(enabled=False)

    response = TestClient(app).post(
        "/v2/auth/login",
        json={"provider": "development", "id_token": "local-user"},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "unsupported_provider"


def test_legacy_dev_provider_is_unsupported_when_flag_is_on():
    app, _ = _app(enabled=True)

    response = TestClient(app).post(
        "/v2/auth/login",
        json={"provider": "dev", "id_token": "local-user"},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "unsupported_provider"


def test_development_login_signs_up_and_accesses_protected_endpoint_when_enabled():
    app, store = _app(enabled=True)
    document = store.publish_consent_document(
        type="terms",
        version="1",
        title="Terms",
        body="# Terms",
        required=True,
    )
    client = TestClient(app)

    login = client.post(
        "/v2/auth/login",
        json={"provider": "development", "id_token": "local-user"},
    )
    assert login.status_code == 200
    access_token = login.json()["access_token"]
    consent = client.post(
        "/v2/consents",
        json={"document_id": str(document.id), "action": "granted"},
        headers={"Authorization": f"Bearer {access_token}"},
    )

    assert login.json()["user"]["email"] is None
    assert login.json()["pending_consents"][0]["id"] == str(document.id)
    assert consent.status_code == 201
    assert store.get_user_by_identity("development", "local-user") is not None


def test_development_email_login_does_not_link_existing_account():
    store = FakeAuthStore()
    existing = store.create_user(email="actor@example.com")
    app, _ = _app(enabled=True, store=store)

    response = TestClient(app).post(
        "/v2/auth/login",
        json={
            "provider": "development",
            "id_token": "local-user:ACTOR@example.com",
        },
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "account_exists_with_different_provider"
    assert store.get_user(existing.id) is existing
    assert store.get_user_by_identity("development", "local-user") is None
    assert len(store.users) == 1
