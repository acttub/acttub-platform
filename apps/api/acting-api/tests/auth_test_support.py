from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

from acting_api.auth.providers import ProviderIdentity
from acting_api.db.models import ConsentAction, ConsentType, UserStatus
from acting_api.db.store import RefreshTokenRotation


class FakeProviderVerifier:
    def __init__(self, provider="google"):
        self.provider = provider
        self.results: dict[str, ProviderIdentity | Exception] = {}
        self.calls: list[str] = []

    def add(
        self,
        token: str,
        *,
        provider_uid: str,
        email: str | None = None,
        email_verified: bool = False,
    ) -> None:
        self.results[token] = ProviderIdentity(
            provider_uid=provider_uid,
            email=email,
            email_verified=email_verified,
        )

    def verify(self, id_token: str) -> ProviderIdentity:
        self.calls.append(id_token)
        result = self.results[id_token]
        if isinstance(result, Exception):
            raise result
        return result


class FakeAuthStore:
    def __init__(self):
        self.users = {}
        self.identities = {}
        self.refresh_tokens = {}
        self.documents = {}
        self.consent_events = []

    def create_user(self, *, email=None, status=UserStatus.ACTIVE):
        row = SimpleNamespace(
            id=uuid4(),
            email=email,
            status=UserStatus(status),
            created_at=datetime.now(timezone.utc),
        )
        self.users[row.id] = row
        return row

    def get_user(self, user_id):
        return self.users.get(user_id)

    def get_user_by_email(self, email):
        return next((row for row in self.users.values() if row.email == email), None)

    def get_user_by_identity(self, provider, provider_uid):
        identity = self.identities.get((str(provider), provider_uid))
        return self.users.get(identity.user_id) if identity else None

    def create_user_with_identity(
        self, *, provider, provider_uid, email=None, status=UserStatus.ACTIVE
    ):
        user = self.create_user(email=email, status=status)
        identity = self.link_user_identity(
            user_id=user.id,
            provider=provider,
            provider_uid=provider_uid,
        )
        return user, identity

    def link_user_identity(self, *, user_id, provider, provider_uid):
        key = (str(provider), provider_uid)
        existing = self.identities.get(key)
        if existing is not None:
            if existing.user_id != user_id:
                raise RuntimeError("identity already linked")
            return existing
        row = SimpleNamespace(
            id=uuid4(),
            user_id=user_id,
            provider=str(provider),
            provider_uid=provider_uid,
            created_at=datetime.now(timezone.utc),
        )
        self.identities[key] = row
        return row

    def issue_refresh_token(
        self,
        *,
        user_id,
        token_hash,
        expires_at,
        device_info=None,
        issued_at=None,
    ):
        row = SimpleNamespace(
            id=uuid4(),
            user_id=user_id,
            token_hash=token_hash,
            expires_at=expires_at,
            device_info=device_info,
            issued_at=issued_at or datetime.now(timezone.utc),
            replaced_by_id=None,
            revoked_at=None,
        )
        self.refresh_tokens[token_hash] = row
        return row

    def get_refresh_token(self, token_hash):
        return self.refresh_tokens.get(token_hash)

    def rotate_refresh_token(
        self,
        *,
        token_hash,
        new_token_hash,
        expires_at,
        device_info=None,
        now=None,
    ):
        now = now or datetime.now(timezone.utc)
        current = self.refresh_tokens.get(token_hash)
        if current is None:
            return RefreshTokenRotation(None, False)
        if current.replaced_by_id is not None:
            self.revoke_all_refresh_tokens(current.user_id, now=now)
            return RefreshTokenRotation(None, True)
        if current.revoked_at is not None or current.expires_at <= now:
            current.revoked_at = current.revoked_at or now
            return RefreshTokenRotation(None, False)
        replacement = self.issue_refresh_token(
            user_id=current.user_id,
            token_hash=new_token_hash,
            expires_at=expires_at,
            device_info=device_info,
            issued_at=now,
        )
        current.replaced_by_id = replacement.id
        current.revoked_at = now
        return RefreshTokenRotation(replacement, False)

    def revoke_refresh_token(self, token_hash, *, now=None):
        row = self.refresh_tokens.get(token_hash)
        if row is None or row.revoked_at is not None:
            return False
        row.revoked_at = now or datetime.now(timezone.utc)
        return True

    def revoke_all_refresh_tokens(self, user_id, *, now=None):
        now = now or datetime.now(timezone.utc)
        count = 0
        for row in self.refresh_tokens.values():
            if row.user_id == user_id and row.revoked_at is None:
                row.revoked_at = now
                count += 1
        return count

    def publish_consent_document(
        self,
        *,
        type,
        version,
        title,
        body,
        required=False,
        published_at=None,
    ):
        row = SimpleNamespace(
            id=uuid4(),
            type=ConsentType(type),
            version=version,
            title=title,
            body=body,
            required=required,
            published_at=published_at or datetime.now(timezone.utc),
        )
        self.documents[row.id] = row
        return row

    def get_consent_document(self, document_id):
        return self.documents.get(document_id)

    def get_consent_document_by_type_version(self, type, version):
        consent_type = ConsentType(type)
        return next(
            (
                row
                for row in self.documents.values()
                if row.type == consent_type and row.version == version
            ),
            None,
        )

    def list_consent_documents(self):
        return sorted(
            self.documents.values(), key=lambda row: (row.published_at, row.id)
        )

    def list_latest_consent_documents(self):
        latest = {}
        for row in self.documents.values():
            previous = latest.get(row.type)
            if previous is None or (row.published_at, row.id) > (
                previous.published_at,
                previous.id,
            ):
                latest[row.type] = row
        return [latest[key] for key in sorted(latest, key=lambda item: item.value)]

    def record_user_consent(
        self, *, user_id, document_id, action, occurred_at=None
    ):
        row = SimpleNamespace(
            id=uuid4(),
            user_id=user_id,
            document_id=document_id,
            action=ConsentAction(action),
            occurred_at=occurred_at or datetime.now(timezone.utc),
        )
        self.consent_events.append(row)
        return row

    def get_current_user_consents(self, user_id):
        latest = {}
        for row in self.consent_events:
            if row.user_id != user_id:
                continue
            previous = latest.get(row.document_id)
            if previous is None or (row.occurred_at, row.id) > (
                previous.occurred_at,
                previous.id,
            ):
                latest[row.document_id] = row
        return list(latest.values())

    def has_pending_required_consents(self, user_id):
        current = {
            row.document_id: row.action
            for row in self.get_current_user_consents(user_id)
        }
        return any(
            document.required
            and current.get(document.id) != ConsentAction.GRANTED
            for document in self.list_latest_consent_documents()
        )
