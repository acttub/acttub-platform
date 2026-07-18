from __future__ import annotations

from datetime import timedelta

from fastapi.testclient import TestClient
from sqlalchemy.exc import IntegrityError

from acting_agent.config import Settings as AgentSettings
from acting_api.app import create_app
from acting_api.auth.jwt import JwtService
from acting_api.auth.providers import InvalidIdentityToken, ProviderRegistry
from acting_api.config import GatewaySettings
from acting_api.db.models import UserStatus
from acting_api.db.store import IdentityAlreadyLinkedError
from acting_api.security import hash_token
from acting_report.config import Settings as ReportSettings
from acting_summary.config import Settings as SummarySettings
from api_test_support import FakeClient
from auth_test_support import FakeAuthStore, FakeProviderVerifier

JWT_SECRET = "stage-2-test-jwt-secret"


def _app(*, store=None, verifier=None, clock=None):
    store = store or FakeAuthStore()
    verifier = verifier or FakeProviderVerifier()
    kwargs = {"clock": clock} if clock is not None else {}
    app = create_app(
        client=FakeClient(),
        gateway_settings=GatewaySettings(
            database_url="postgresql+psycopg://unused/unused",
            jwt_secret=JWT_SECRET,
        ),
        summary_settings=SummarySettings(api_key="k", model="m"),
        agent_settings=AgentSettings(api_key="k", model="m"),
        report_settings=ReportSettings(api_key="k", model="m"),
        store=store,
        provider_registry=ProviderRegistry(
            verifier if isinstance(verifier, list) else [verifier]
        ),
        **kwargs,
    )
    return app, store, verifier


def _login(client, token="provider-token"):
    return client.post(
        "/v2/auth/login",
        json={"provider": "google", "id_token": token},
    )


def _bearer(access_token):
    return {"Authorization": f"Bearer {access_token}"}


def test_login_creates_user_stores_only_refresh_hash_and_lists_pending_consents():
    app, store, verifier = _app()
    verifier.add(
        "provider-token",
        provider_uid="google-1",
        email=" USER@Example.com ",
        email_verified=True,
    )
    required = store.publish_consent_document(
        type="terms", version="1", title="Terms", body="# Terms", required=True
    )
    store.publish_consent_document(
        type="privacy", version="1", title="Privacy", body="# Privacy"
    )

    response = _login(TestClient(app))

    assert response.status_code == 200
    body = response.json()
    assert body["token_type"] == "bearer"
    assert body["expires_in"] == 1800
    assert body["user"]["email"] == "user@example.com"
    assert [item["id"] for item in body["pending_consents"]] == [str(required.id)]
    assert body["refresh_token"] not in store.refresh_tokens
    assert hash_token(body["refresh_token"]) in store.refresh_tokens


def test_existing_identity_logs_into_same_user():
    app, store, verifier = _app()
    verifier.add("provider-token", provider_uid="google-1")
    client = TestClient(app)
    first = _login(client)
    second = _login(client)
    assert first.status_code == second.status_code == 200
    assert first.json()["user"]["id"] == second.json()["user"]["id"]
    assert len(store.users) == 1
    assert len(store.identities) == 1


def test_verified_email_collision_links_identity():
    app, store, verifier = _app()
    user = store.create_user(email="same@example.com")
    verifier.add(
        "provider-token",
        provider_uid="new-google",
        email="SAME@example.com",
        email_verified=True,
    )

    response = _login(TestClient(app))

    assert response.status_code == 200
    assert response.json()["user"]["id"] == str(user.id)
    assert store.get_user_by_identity("google", "new-google") is user


def test_unverified_email_collision_is_409():
    app, store, verifier = _app()
    store.create_user(email="same@example.com")
    verifier.add(
        "provider-token",
        provider_uid="new-google",
        email="same@example.com",
        email_verified=False,
    )
    response = _login(TestClient(app))
    assert response.status_code == 409
    assert response.json()["detail"] == "account_exists_with_different_provider"
    assert len(store.identities) == 0


def test_unverified_signup_cannot_capture_later_verified_email_login():
    google = FakeProviderVerifier("google")
    apple = FakeProviderVerifier("apple")
    google.add(
        "attacker",
        provider_uid="attacker-google",
        email="victim@example.com",
        email_verified=False,
    )
    apple.add(
        "victim",
        provider_uid="victim-apple",
        email="victim@example.com",
        email_verified=True,
    )
    app, store, _ = _app(verifier=[google, apple])
    client = TestClient(app)

    attacker = client.post(
        "/v2/auth/login",
        json={"provider": "google", "id_token": "attacker"},
    )
    victim = client.post(
        "/v2/auth/login",
        json={"provider": "apple", "id_token": "victim"},
    )

    assert attacker.status_code == victim.status_code == 200
    assert attacker.json()["user"]["email"] is None
    assert victim.json()["user"]["email"] == "victim@example.com"
    assert attacker.json()["user"]["id"] != victim.json()["user"]["id"]


def test_concurrent_identity_creation_race_reloads_winner():
    class CreateRaceStore(FakeAuthStore):
        def create_user_with_identity(self, **kwargs):
            winner = super().create_user_with_identity(**kwargs)
            if not hasattr(self, "winner"):
                self.winner = winner[0]
                raise IntegrityError("insert identity", {}, Exception("race"))
            return winner

    store = CreateRaceStore()
    app, _, verifier = _app(store=store)
    verifier.add("provider-token", provider_uid="raced-google")

    response = _login(TestClient(app, raise_server_exceptions=False))

    assert response.status_code == 200
    assert response.json()["user"]["id"] == str(store.winner.id)
    assert len(store.identities) == 1


def test_concurrent_identity_link_race_reloads_winner():
    class LinkRaceStore(FakeAuthStore):
        def link_user_identity(self, *, user_id, provider, provider_uid):
            if not hasattr(self, "winner"):
                self.winner = self.create_user()
                super().link_user_identity(
                    user_id=self.winner.id,
                    provider=provider,
                    provider_uid=provider_uid,
                )
                raise IdentityAlreadyLinkedError("identity won by concurrent login")
            return super().link_user_identity(
                user_id=user_id,
                provider=provider,
                provider_uid=provider_uid,
            )

    store = LinkRaceStore()
    store.create_user(email="same@example.com")
    app, _, verifier = _app(store=store)
    verifier.add(
        "provider-token",
        provider_uid="raced-google",
        email="same@example.com",
        email_verified=True,
    )

    response = _login(TestClient(app, raise_server_exceptions=False))

    assert response.status_code == 200
    assert response.json()["user"]["id"] == str(store.winner.id)


def test_invalid_provider_token_is_401_and_suspended_user_is_403():
    app, store, verifier = _app()
    verifier.results["bad"] = InvalidIdentityToken("bad")
    assert _login(TestClient(app), "bad").status_code == 401

    suspended, _ = store.create_user_with_identity(
        provider="google",
        provider_uid="suspended-google",
        status=UserStatus.SUSPENDED,
    )
    verifier.add("suspended", provider_uid="suspended-google")
    response = _login(TestClient(app), "suspended")
    assert response.status_code == 403
    assert response.json()["detail"] == "account_suspended"
    assert suspended.status == UserStatus.SUSPENDED


def test_failed_login_verification_is_limited_by_client_ip_before_provider_call():
    app, _, verifier = _app(clock=lambda: 0.0)
    verifier.results["bad"] = InvalidIdentityToken("bad")
    client = TestClient(app)

    for _ in range(60):
        assert _login(client, "bad").status_code == 401
    limited = _login(client, "bad")

    assert limited.status_code == 429
    assert verifier.calls == ["bad"] * 60


def test_invalid_refresh_guesses_are_limited_by_client_ip():
    app, _, _ = _app(clock=lambda: 0.0)
    client = TestClient(app)

    for _ in range(60):
        assert client.post(
            "/v2/auth/refresh", json={"refresh_token": "not-a-token"}
        ).status_code == 401

    assert client.post(
        "/v2/auth/refresh", json={"refresh_token": "not-a-token"}
    ).status_code == 429


def test_refresh_rotates_and_reuse_revokes_all_user_tokens():
    app, store, verifier = _app()
    verifier.add("provider-token", provider_uid="google-1")
    client = TestClient(app)
    login = _login(client).json()
    first_refresh = login["refresh_token"]

    rotated = client.post(
        "/v2/auth/refresh", json={"refresh_token": first_refresh}
    )
    assert rotated.status_code == 200
    second_refresh = rotated.json()["refresh_token"]
    assert second_refresh != first_refresh
    replacement = store.refresh_tokens[hash_token(second_refresh)]
    assert replacement.expires_at - replacement.issued_at == timedelta(days=14)
    assert store.refresh_tokens[hash_token(first_refresh)].replaced_by_id is not None

    reused = client.post(
        "/v2/auth/refresh", json={"refresh_token": first_refresh}
    )
    assert reused.status_code == 401
    user_id = store.refresh_tokens[hash_token(first_refresh)].user_id
    assert all(
        row.revoked_at is not None
        for row in store.refresh_tokens.values()
        if row.user_id == user_id
    )


def test_logout_revokes_refresh_token_and_requires_own_access_token():
    app, store, verifier = _app()
    verifier.add("provider-token", provider_uid="google-1")
    client = TestClient(app)
    login = _login(client).json()

    response = client.post(
        "/v2/auth/logout",
        json={"refresh_token": login["refresh_token"]},
        headers=_bearer(login["access_token"]),
    )
    assert response.status_code == 204
    assert store.refresh_tokens[hash_token(login["refresh_token"])].revoked_at
    assert (
        client.post(
            "/v2/auth/refresh", json={"refresh_token": login["refresh_token"]}
        ).status_code
        == 401
    )


def test_consent_documents_are_public_and_consent_events_require_bearer():
    app, store, verifier = _app()
    verifier.add("provider-token", provider_uid="google-1")
    document = store.publish_consent_document(
        type="terms", version="1", title="Terms", body="# Terms", required=True
    )
    client = TestClient(app)

    documents = client.get("/v2/consents/documents")
    assert documents.status_code == 200
    assert documents.json()["documents"][0]["body"] == "# Terms"
    assert (
        client.post(
            "/v2/consents",
            json={"document_id": str(document.id), "action": "granted"},
        ).status_code
        == 401
    )

    login = _login(client).json()
    declined = client.post(
        "/v2/consents",
        json={"document_id": str(document.id), "action": "declined"},
        headers=_bearer(login["access_token"]),
    )
    assert declined.status_code == 201
    assert declined.json()["action"] == "declined"

    granted = client.post(
        "/v2/consents",
        json={"document_id": str(document.id), "action": "granted"},
        headers=_bearer(login["access_token"]),
    )
    assert granted.status_code == 201
    assert granted.json()["action"] == "granted"
    assert len(store.consent_events) == 2

    logged_in_again = _login(client).json()
    assert logged_in_again["pending_consents"] == []

    revoked = client.post(
        "/v2/consents",
        json={"document_id": str(document.id), "action": "revoked"},
        headers=_bearer(login["access_token"]),
    )
    assert revoked.status_code == 201
    assert _login(client).json()["pending_consents"][0]["id"] == str(document.id)


def test_bearer_dependency_rejects_invalid_token_and_suspended_user():
    app, store, _ = _app()
    client = TestClient(app)
    assert (
        client.post(
            "/v2/consents",
            json={"document_id": "00000000-0000-0000-0000-000000000000", "action": "granted"},
            headers=_bearer("not-a-jwt"),
        ).status_code
        == 401
    )

    suspended = store.create_user(status=UserStatus.SUSPENDED)
    access = JwtService(JWT_SECRET).issue_access_token(suspended.id).value
    response = client.post(
        "/v2/consents",
        json={"document_id": "00000000-0000-0000-0000-000000000000", "action": "granted"},
        headers=_bearer(access),
    )
    assert response.status_code == 403


def test_v2_user_rate_limit_is_60_per_fixed_window():
    app, store, _ = _app(clock=lambda: 0.0)
    user = store.create_user()
    document = store.publish_consent_document(
        type="terms", version="1", title="Terms", body="# Terms"
    )
    access = JwtService(JWT_SECRET).issue_access_token(user.id).value
    client = TestClient(app)
    request = {
        "document_id": str(document.id),
        "action": "granted",
    }
    headers = _bearer(access)

    for _ in range(60):
        assert client.post("/v2/consents", json=request, headers=headers).status_code == 201
    assert client.post("/v2/consents", json=request, headers=headers).status_code == 429


def test_missing_google_client_id_is_reported_at_login_not_boot():
    app, store, _ = _app()
    # Replace the injected fake registry with the real default configuration path.
    from acting_api.auth.google import GoogleProviderVerifier

    app, _, _ = _app(verifier=GoogleProviderVerifier(None))
    response = _login(TestClient(app))
    assert response.status_code == 503
    assert response.json()["detail"] == "provider_not_configured"
