from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import Engine, and_, func, or_, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from acting_agent.schema import CoachSession as AgentCoachSession
from acting_agent.schema import CoachTurn as AgentCoachTurn
from acting_agent.store import SessionWriteConflict
from acting_agent.summary_schema import SceneSummary as AgentSceneSummary
from acting_agent.summary_schema import SubText as AgentSubText
from acting_api.db.engine import create_db_engine, create_session_factory
from acting_api.db.models import (
    Anomaly as DbAnomaly,
    CloseReason,
    CoachSession as DbCoachSession,
    CoachTurn as DbCoachTurn,
    ConsentAction,
    ConsentDocument,
    ConsentType,
    ExternalOperation,
    IdentityProvider,
    IntentImpact,
    OperationKind,
    OperationStatus,
    PracticeSession,
    PracticeStatus,
    RefreshToken,
    Report as DbReport,
    SessionStatus,
    Severity,
    Summary,
    TurnRole,
    UploadIntent,
    UploadStatus,
    User,
    UserConsent,
    UserIdentity,
    UserStatus,
)
from acting_report.schema import ActingReport, BiggestProblem, ReportRecord
from acting_report.session_schema import CoachSession as ReportCoachSession
from acting_report.session_schema import CoachTurn as ReportCoachTurn
from acting_report.summary_schema import SceneSummary as ReportSceneSummary
from acting_report.summary_schema import SubText as ReportSubText
from acting_summary.schema import SceneSummary as SummarySceneSummary

MAX_EXTERNAL_OPERATION_ATTEMPTS = 3


class IdentityAlreadyLinkedError(RuntimeError):
    pass


class LeaseOwnershipError(RuntimeError):
    pass


@dataclass(frozen=True)
class RefreshTokenRotation:
    token: RefreshToken | None
    reused_rotated_token: bool


@dataclass(frozen=True)
class ExternalOperationLookup:
    operation: ExternalOperation
    created: bool
    fingerprint_mismatch: bool


@dataclass(frozen=True)
class PracticeSessionOperation:
    session: PracticeSession
    operation: ExternalOperation
    created: bool
    fingerprint_mismatch: bool


@dataclass(frozen=True)
class PracticeSessionDetail:
    session: PracticeSession
    upload: UploadIntent
    summary: Summary | None
    operation: ExternalOperation | None


@dataclass(frozen=True)
class AnalysisContext:
    operation: ExternalOperation
    session: PracticeSession
    upload: UploadIntent


@dataclass(frozen=True)
class OwnedSummaryContext:
    practice_session_id: UUID
    summary: AgentSceneSummary
    subtext: AgentSubText


@dataclass(frozen=True)
class OwnedCoachSessionContext:
    practice_session_id: UUID
    session: AgentCoachSession


@dataclass(frozen=True)
class OwnedReportContext:
    practice_session_id: UUID
    session: ReportCoachSession


@dataclass(frozen=True)
class _SessionData:
    practice_session_id: UUID
    session_id: UUID
    summary_id: UUID
    user_id: UUID
    raw_summary: dict[str, Any]
    situation: str
    character_context: str
    subtext: str
    status: str
    close_reason: str
    turns: list[DbCoachTurn]

    @property
    def question_count(self) -> int:
        return sum(
            turn.role == TurnRole.AI and turn.action not in (None, "close")
            for turn in self.turns
        )


class PostgresStore:
    def __init__(self, engine: Engine):
        self._engine = engine
        self._session_factory: sessionmaker[Session] = create_session_factory(engine)

    @classmethod
    def from_url(cls, database_url: str) -> PostgresStore:
        return cls(create_db_engine(database_url, pool_pre_ping=True))

    def close(self) -> None:
        self._engine.dispose()

    # ---- users and identities ----

    def create_user(
        self,
        *,
        email: str | None = None,
        status: UserStatus | str = UserStatus.ACTIVE,
    ) -> User:
        row = User(id=uuid4(), email=email, status=UserStatus(status))
        with self._session_factory.begin() as db:
            db.add(row)
        return row

    def get_user(self, user_id: UUID) -> User | None:
        with self._session_factory() as db:
            return db.get(User, user_id)

    def get_user_by_email(self, email: str) -> User | None:
        with self._session_factory() as db:
            return db.scalar(select(User).where(func.lower(User.email) == email.lower()))

    def get_user_by_identity(
        self, provider: IdentityProvider | str, provider_uid: str
    ) -> User | None:
        with self._session_factory() as db:
            return db.scalar(
                select(User)
                .join(UserIdentity, UserIdentity.user_id == User.id)
                .where(
                    UserIdentity.provider == IdentityProvider(provider),
                    UserIdentity.provider_uid == provider_uid,
                )
            )

    def create_user_with_identity(
        self,
        *,
        provider: IdentityProvider | str,
        provider_uid: str,
        email: str | None = None,
        status: UserStatus | str = UserStatus.ACTIVE,
    ) -> tuple[User, UserIdentity]:
        user = User(id=uuid4(), email=email, status=UserStatus(status))
        identity = UserIdentity(
            id=uuid4(),
            user_id=user.id,
            provider=IdentityProvider(provider),
            provider_uid=provider_uid,
        )
        with self._session_factory.begin() as db:
            db.add(user)
            db.flush()
            db.add(identity)
        return user, identity

    def link_user_identity(
        self,
        *,
        user_id: UUID,
        provider: IdentityProvider | str,
        provider_uid: str,
    ) -> UserIdentity:
        provider_value = IdentityProvider(provider)
        identity_id = uuid4()
        with self._session_factory.begin() as db:
            inserted_id = db.scalar(
                insert(UserIdentity)
                .values(
                    id=identity_id,
                    user_id=user_id,
                    provider=provider_value,
                    provider_uid=provider_uid,
                )
                .on_conflict_do_nothing(
                    index_elements=[UserIdentity.provider, UserIdentity.provider_uid]
                )
                .returning(UserIdentity.id)
            )
            if inserted_id is not None:
                return db.get(UserIdentity, inserted_id)
            existing = db.scalar(
                select(UserIdentity).where(
                    UserIdentity.provider == provider_value,
                    UserIdentity.provider_uid == provider_uid,
                )
            )
            if existing is None or existing.user_id != user_id:
                raise IdentityAlreadyLinkedError(
                    "identity is already linked to another user"
                )
            return existing

    # ---- refresh tokens ----

    def issue_refresh_token(
        self,
        *,
        user_id: UUID,
        token_hash: str,
        expires_at: datetime,
        device_info: str | None = None,
        issued_at: datetime | None = None,
    ) -> RefreshToken:
        self._validate_sha256(token_hash)
        row = RefreshToken(
            id=uuid4(),
            user_id=user_id,
            token_hash=token_hash,
            device_info=device_info,
            issued_at=issued_at or datetime.now(timezone.utc),
            expires_at=expires_at,
        )
        with self._session_factory.begin() as db:
            db.add(row)
        return row

    def get_refresh_token(self, token_hash: str) -> RefreshToken | None:
        self._validate_sha256(token_hash)
        with self._session_factory() as db:
            return db.scalar(
                select(RefreshToken).where(RefreshToken.token_hash == token_hash)
            )

    def rotate_refresh_token(
        self,
        *,
        token_hash: str,
        new_token_hash: str,
        expires_at: datetime,
        device_info: str | None = None,
        now: datetime | None = None,
    ) -> RefreshTokenRotation:
        self._validate_sha256(token_hash)
        self._validate_sha256(new_token_hash)
        now = now or datetime.now(timezone.utc)
        with self._session_factory.begin() as db:
            current = db.scalar(
                select(RefreshToken)
                .where(RefreshToken.token_hash == token_hash)
                .with_for_update()
            )
            if current is None:
                return RefreshTokenRotation(None, False)
            if current.replaced_by_id is not None:
                db.execute(
                    update(RefreshToken)
                    .where(
                        RefreshToken.user_id == current.user_id,
                        RefreshToken.revoked_at.is_(None),
                    )
                    .values(revoked_at=now)
                )
                return RefreshTokenRotation(None, True)
            if current.revoked_at is not None or current.expires_at <= now:
                if current.revoked_at is None:
                    current.revoked_at = now
                return RefreshTokenRotation(None, False)
            replacement = RefreshToken(
                id=uuid4(),
                user_id=current.user_id,
                token_hash=new_token_hash,
                device_info=(device_info if device_info is not None else current.device_info),
                issued_at=now,
                expires_at=expires_at,
            )
            db.add(replacement)
            db.flush()
            current.replaced_by_id = replacement.id
            current.revoked_at = now
            return RefreshTokenRotation(replacement, False)

    def revoke_refresh_token(
        self, token_hash: str, *, now: datetime | None = None
    ) -> bool:
        self._validate_sha256(token_hash)
        now = now or datetime.now(timezone.utc)
        with self._session_factory.begin() as db:
            result = db.execute(
                update(RefreshToken)
                .where(
                    RefreshToken.token_hash == token_hash,
                    RefreshToken.revoked_at.is_(None),
                )
                .values(revoked_at=now)
            )
            return bool(result.rowcount)

    def revoke_all_refresh_tokens(
        self, user_id: UUID, *, now: datetime | None = None
    ) -> int:
        now = now or datetime.now(timezone.utc)
        with self._session_factory.begin() as db:
            result = db.execute(
                update(RefreshToken)
                .where(
                    RefreshToken.user_id == user_id,
                    RefreshToken.revoked_at.is_(None),
                )
                .values(revoked_at=now)
            )
            return result.rowcount

    # ---- consent documents and events ----

    def publish_consent_document(
        self,
        *,
        type: ConsentType | str,
        version: str,
        title: str,
        body: str,
        required: bool = False,
        published_at: datetime | None = None,
    ) -> ConsentDocument:
        row = ConsentDocument(
            id=uuid4(),
            type=ConsentType(type),
            version=version,
            title=title,
            body=body,
            required=required,
            published_at=published_at or datetime.now(timezone.utc),
        )
        with self._session_factory.begin() as db:
            db.add(row)
        return row

    def list_latest_consent_documents(self) -> list[ConsentDocument]:
        with self._session_factory() as db:
            return list(
                db.scalars(
                    select(ConsentDocument)
                    .distinct(ConsentDocument.type)
                    .order_by(
                        ConsentDocument.type,
                        ConsentDocument.published_at.desc(),
                        ConsentDocument.id.desc(),
                    )
                )
            )

    def get_consent_document(self, document_id: UUID) -> ConsentDocument | None:
        with self._session_factory() as db:
            return db.get(ConsentDocument, document_id)

    def list_consent_documents(self) -> list[ConsentDocument]:
        with self._session_factory() as db:
            return list(
                db.scalars(
                    select(ConsentDocument).order_by(
                        ConsentDocument.published_at,
                        ConsentDocument.id,
                    )
                )
            )

    def record_user_consent(
        self,
        *,
        user_id: UUID,
        document_id: UUID,
        action: ConsentAction | str,
        occurred_at: datetime | None = None,
    ) -> UserConsent:
        row = UserConsent(
            id=uuid4(),
            user_id=user_id,
            document_id=document_id,
            action=ConsentAction(action),
            occurred_at=occurred_at or datetime.now(timezone.utc),
        )
        with self._session_factory.begin() as db:
            db.add(row)
        return row

    def get_current_user_consents(self, user_id: UUID) -> list[UserConsent]:
        with self._session_factory() as db:
            return list(
                db.scalars(
                    select(UserConsent)
                    .where(UserConsent.user_id == user_id)
                    .distinct(UserConsent.document_id)
                    .order_by(
                        UserConsent.document_id,
                        UserConsent.occurred_at.desc(),
                        UserConsent.id.desc(),
                    )
                )
            )

    # ---- upload intents ----

    def create_upload_intent(
        self,
        *,
        user_id: UUID,
        storage_provider: str,
        object_key: str,
        mime_type: str,
        size_bytes: int,
        expires_at: datetime,
        duration_ms: int | None = None,
    ) -> UploadIntent:
        row = UploadIntent(
            id=uuid4(),
            user_id=user_id,
            storage_provider=storage_provider,
            object_key=object_key,
            mime_type=mime_type,
            size_bytes=size_bytes,
            duration_ms=duration_ms,
            expires_at=expires_at,
        )
        with self._session_factory.begin() as db:
            db.add(row)
        return row

    def get_upload_intent(
        self, *, user_id: UUID, upload_intent_id: UUID
    ) -> UploadIntent | None:
        with self._session_factory() as db:
            return db.scalar(
                select(UploadIntent).where(
                    UploadIntent.id == upload_intent_id,
                    UploadIntent.user_id == user_id,
                )
            )

    def finalize_upload_intent(
        self,
        *,
        user_id: UUID,
        upload_intent_id: UUID,
        etag: str,
        now: datetime | None = None,
    ) -> UploadIntent | None:
        now = now or datetime.now(timezone.utc)
        with self._session_factory.begin() as db:
            return db.scalars(
                update(UploadIntent)
                .where(
                    UploadIntent.id == upload_intent_id,
                    UploadIntent.user_id == user_id,
                    UploadIntent.status == UploadStatus.PENDING,
                    UploadIntent.expires_at > now,
                )
                .values(
                    status=UploadStatus.FINALIZED,
                    finalized_at=now,
                    etag=etag,
                )
                .returning(UploadIntent)
            ).one_or_none()

    def sweep_expired_upload_intents(
        self, *, now: datetime | None = None
    ) -> list[str]:
        now = now or datetime.now(timezone.utc)
        with self._session_factory.begin() as db:
            return list(
                db.scalars(
                    update(UploadIntent)
                    .where(
                        UploadIntent.status == UploadStatus.PENDING,
                        UploadIntent.expires_at < now,
                    )
                    .values(status=UploadStatus.EXPIRED)
                    .returning(UploadIntent.object_key)
                )
            )

    # ---- practice sessions ----

    def create_practice_session(
        self,
        *,
        user_id: UUID,
        upload_intent_id: UUID,
        situation: str,
        character_context: str,
        subtext: str,
        status: PracticeStatus | str = PracticeStatus.CREATED,
    ) -> PracticeSession | None:
        row = PracticeSession(
            id=uuid4(),
            user_id=user_id,
            upload_intent_id=upload_intent_id,
            status=PracticeStatus(status),
            situation=situation,
            character_context=character_context,
            subtext=subtext,
        )
        with self._session_factory.begin() as db:
            upload_exists = db.scalar(
                select(UploadIntent.id)
                .where(
                    UploadIntent.id == upload_intent_id,
                    UploadIntent.user_id == user_id,
                    UploadIntent.status == UploadStatus.FINALIZED,
                )
                .with_for_update()
            )
            if upload_exists is None:
                return None
            db.add(row)
        return row

    def create_practice_session_with_analysis_operation(
        self,
        *,
        user_id: UUID,
        upload_intent_id: UUID,
        situation: str,
        character_context: str,
        subtext: str,
        request_id: UUID,
        request_fingerprint: str,
    ) -> PracticeSessionOperation | None:
        self._validate_sha256(request_fingerprint)
        with self._session_factory.begin() as db:
            upload = db.scalar(
                select(UploadIntent)
                .where(
                    UploadIntent.id == upload_intent_id,
                    UploadIntent.user_id == user_id,
                    UploadIntent.status == UploadStatus.FINALIZED,
                )
                .with_for_update()
            )
            if upload is None:
                return None
            existing = db.scalar(
                select(ExternalOperation).where(
                    ExternalOperation.user_id == user_id,
                    ExternalOperation.request_id == request_id,
                )
            )
            if existing is not None:
                session = db.get(PracticeSession, existing.session_id)
                return PracticeSessionOperation(
                    session=session,
                    operation=existing,
                    created=False,
                    fingerprint_mismatch=(
                        existing.request_fingerprint != request_fingerprint
                    ),
                )
            if db.scalar(
                select(PracticeSession.id).where(
                    PracticeSession.upload_intent_id == upload_intent_id
                )
            ) is not None:
                return None

            session = PracticeSession(
                id=uuid4(),
                user_id=user_id,
                upload_intent_id=upload_intent_id,
                status=PracticeStatus.ANALYZING,
                situation=situation,
                character_context=character_context,
                subtext=subtext,
            )
            db.add(session)
            db.flush()
            operation_id = uuid4()
            inserted_id = db.scalar(
                insert(ExternalOperation)
                .values(
                    id=operation_id,
                    session_id=session.id,
                    user_id=user_id,
                    request_id=request_id,
                    kind=OperationKind.ANALYZE,
                    request_fingerprint=request_fingerprint,
                )
                .on_conflict_do_nothing(
                    index_elements=[
                        ExternalOperation.user_id,
                        ExternalOperation.request_id,
                    ]
                )
                .returning(ExternalOperation.id)
            )
            if inserted_id is None:
                db.delete(session)
                db.flush()
                existing = db.scalar(
                    select(ExternalOperation).where(
                        ExternalOperation.user_id == user_id,
                        ExternalOperation.request_id == request_id,
                    )
                )
                existing_session = db.get(PracticeSession, existing.session_id)
                return PracticeSessionOperation(
                    session=existing_session,
                    operation=existing,
                    created=False,
                    fingerprint_mismatch=(
                        existing.request_fingerprint != request_fingerprint
                    ),
                )
            operation = db.get(ExternalOperation, inserted_id)
            return PracticeSessionOperation(
                session=session,
                operation=operation,
                created=True,
                fingerprint_mismatch=False,
            )

    def create_analysis_retry_operation(
        self,
        *,
        user_id: UUID,
        session_id: UUID,
        request_id: UUID,
        request_fingerprint: str,
        now: datetime | None = None,
    ) -> PracticeSessionOperation | None:
        self._validate_sha256(request_fingerprint)
        now = now or datetime.now(timezone.utc)
        with self._session_factory.begin() as db:
            session = db.scalar(
                select(PracticeSession)
                .where(
                    PracticeSession.id == session_id,
                    PracticeSession.user_id == user_id,
                    PracticeSession.hidden_at.is_(None),
                )
                .with_for_update()
            )
            if session is None:
                return None
            existing = db.scalar(
                select(ExternalOperation).where(
                    ExternalOperation.user_id == user_id,
                    ExternalOperation.request_id == request_id,
                )
            )
            if existing is not None:
                existing_session = db.get(PracticeSession, existing.session_id)
                return PracticeSessionOperation(
                    session=existing_session,
                    operation=existing,
                    created=False,
                    fingerprint_mismatch=(
                        existing.session_id != session_id
                        or existing.request_fingerprint != request_fingerprint
                    ),
                )
            if session.status != PracticeStatus.FAILED:
                return None
            operation_id = uuid4()
            inserted_id = db.scalar(
                insert(ExternalOperation)
                .values(
                    id=operation_id,
                    session_id=session.id,
                    user_id=user_id,
                    request_id=request_id,
                    kind=OperationKind.ANALYZE,
                    request_fingerprint=request_fingerprint,
                )
                .on_conflict_do_nothing(
                    index_elements=[
                        ExternalOperation.user_id,
                        ExternalOperation.request_id,
                    ]
                )
                .returning(ExternalOperation.id)
            )
            if inserted_id is None:
                existing = db.scalar(
                    select(ExternalOperation).where(
                        ExternalOperation.user_id == user_id,
                        ExternalOperation.request_id == request_id,
                    )
                )
                existing_session = db.get(PracticeSession, existing.session_id)
                return PracticeSessionOperation(
                    session=existing_session,
                    operation=existing,
                    created=False,
                    fingerprint_mismatch=(
                        existing.session_id != session_id
                        or existing.request_fingerprint != request_fingerprint
                    ),
                )
            session.status = PracticeStatus.ANALYZING
            session.updated_at = now
            operation = db.get(ExternalOperation, inserted_id)
            return PracticeSessionOperation(
                session=session,
                operation=operation,
                created=True,
                fingerprint_mismatch=False,
            )

    def resume_failed_analysis_operation(
        self,
        *,
        user_id: UUID,
        operation_id: UUID,
        now: datetime | None = None,
        max_attempts: int = MAX_EXTERNAL_OPERATION_ATTEMPTS,
    ) -> bool:
        now = now or datetime.now(timezone.utc)
        with self._session_factory.begin() as db:
            operation = db.scalar(
                select(ExternalOperation)
                .where(
                    ExternalOperation.id == operation_id,
                    ExternalOperation.user_id == user_id,
                    ExternalOperation.kind == OperationKind.ANALYZE,
                    ExternalOperation.status == OperationStatus.FAILED,
                    ExternalOperation.attempt_count < max_attempts,
                    ExternalOperation.lease_token.is_(None),
                )
                .with_for_update()
            )
            if operation is None:
                return False
            session = db.scalar(
                select(PracticeSession).where(
                    PracticeSession.id == operation.session_id,
                    PracticeSession.user_id == user_id,
                    PracticeSession.hidden_at.is_(None),
                    PracticeSession.status == PracticeStatus.FAILED,
                )
            )
            if session is None:
                return False
            operation.status = OperationStatus.PENDING
            operation.error_code = None
            operation.response_payload = None
            operation.updated_at = now
            session.status = PracticeStatus.ANALYZING
            session.updated_at = now
            return True

    def get_practice_session(
        self,
        *,
        user_id: UUID,
        session_id: UUID,
        include_hidden: bool = False,
    ) -> PracticeSession | None:
        query = select(PracticeSession).where(
            PracticeSession.id == session_id,
            PracticeSession.user_id == user_id,
        )
        if not include_hidden:
            query = query.where(PracticeSession.hidden_at.is_(None))
        with self._session_factory() as db:
            return db.scalar(query)

    def list_practice_sessions(self, user_id: UUID) -> list[PracticeSession]:
        with self._session_factory() as db:
            return list(
                db.scalars(
                    select(PracticeSession)
                    .where(
                        PracticeSession.user_id == user_id,
                        PracticeSession.hidden_at.is_(None),
                    )
                    .order_by(
                        PracticeSession.created_at.desc(),
                        PracticeSession.id.desc(),
                    )
                )
            )

    def get_practice_session_detail(
        self, *, user_id: UUID, session_id: UUID
    ) -> PracticeSessionDetail | None:
        with self._session_factory() as db:
            session = db.scalar(
                select(PracticeSession).where(
                    PracticeSession.id == session_id,
                    PracticeSession.user_id == user_id,
                    PracticeSession.hidden_at.is_(None),
                )
            )
            if session is None:
                return None
            upload = db.get(UploadIntent, session.upload_intent_id)
            summary = db.scalar(
                select(Summary)
                .where(Summary.session_id == session.id)
                .order_by(Summary.created_at.desc(), Summary.id.desc())
                .limit(1)
            )
            operation = db.scalar(
                select(ExternalOperation)
                .where(
                    ExternalOperation.session_id == session.id,
                    ExternalOperation.kind == OperationKind.ANALYZE,
                )
                .order_by(
                    ExternalOperation.created_at.desc(),
                    ExternalOperation.id.desc(),
                )
                .limit(1)
            )
            return PracticeSessionDetail(
                session=session,
                upload=upload,
                summary=summary,
                operation=operation,
            )

    def transition_practice_session_status(
        self,
        *,
        user_id: UUID,
        session_id: UUID,
        status: PracticeStatus | str,
        now: datetime | None = None,
    ) -> bool:
        target = PracticeStatus(status)
        allowed_from = {
            PracticeStatus.ANALYZING: (PracticeStatus.CREATED, PracticeStatus.FAILED),
            PracticeStatus.ANALYZED: (PracticeStatus.ANALYZING,),
            PracticeStatus.FAILED: (PracticeStatus.ANALYZING,),
        }.get(target, ())
        if not allowed_from:
            return False
        now = now or datetime.now(timezone.utc)
        with self._session_factory.begin() as db:
            result = db.execute(
                update(PracticeSession)
                .where(
                    PracticeSession.id == session_id,
                    PracticeSession.user_id == user_id,
                    PracticeSession.hidden_at.is_(None),
                    PracticeSession.status.in_(allowed_from),
                )
                .values(status=target, updated_at=now)
            )
            return bool(result.rowcount)

    def hide_practice_session(
        self,
        *,
        user_id: UUID,
        session_id: UUID,
        now: datetime | None = None,
    ) -> bool:
        now = now or datetime.now(timezone.utc)
        with self._session_factory.begin() as db:
            result = db.execute(
                update(PracticeSession)
                .where(
                    PracticeSession.id == session_id,
                    PracticeSession.user_id == user_id,
                    PracticeSession.hidden_at.is_(None),
                )
                .values(hidden_at=now, updated_at=now)
            )
            return bool(result.rowcount)

    # ---- summaries ----

    def get_owned_summary(
        self, *, user_id: UUID, summary_id: UUID
    ) -> OwnedSummaryContext | None:
        with self._session_factory() as db:
            row = db.execute(
                select(
                    PracticeSession.id,
                    Summary.raw,
                    PracticeSession.situation,
                    PracticeSession.character_context,
                    PracticeSession.subtext,
                )
                .join(Summary, Summary.session_id == PracticeSession.id)
                .where(
                    Summary.id == summary_id,
                    PracticeSession.user_id == user_id,
                    PracticeSession.hidden_at.is_(None),
                )
            ).one_or_none()
            if row is None:
                return None
            (
                practice_session_id,
                raw,
                situation,
                character_context,
                subtext,
            ) = row
            return OwnedSummaryContext(
                practice_session_id=practice_session_id,
                summary=AgentSceneSummary.model_validate(raw),
                subtext=AgentSubText(
                    situation=situation,
                    character=character_context,
                    subtext=subtext,
                ),
            )

    # ---- coach ----

    def get_owned_coach_session(
        self, *, user_id: UUID, coach_session_id: UUID
    ) -> OwnedCoachSessionContext | None:
        with self._session_factory() as db:
            data = self._load_session(
                db,
                coach_session_id,
                user_id=user_id,
                include_hidden=False,
            )
            if data is None:
                return None
            return OwnedCoachSessionContext(
                practice_session_id=data.practice_session_id,
                session=self._agent_coach_session(data),
            )

    @staticmethod
    def _add_coach_session(db: Session, session: AgentCoachSession) -> None:
        session_id = UUID(session.session_id)
        db.add(
            DbCoachSession(
                id=session_id,
                summary_id=UUID(session.summary_id),
                status=SessionStatus(session.status),
                close_reason=(
                    CloseReason(session.close_reason)
                    if session.close_reason
                    else None
                ),
            )
        )
        for index, turn in enumerate(session.turns):
            db.add(PostgresStore._coach_turn(session_id, index, turn))

    @staticmethod
    def _save_coach_session(
        db: Session,
        session: AgentCoachSession,
        *,
        now: datetime | None = None,
    ) -> None:
        session_id = UUID(session.session_id)
        db_session = db.scalar(
            select(DbCoachSession)
            .where(DbCoachSession.id == session_id)
            .with_for_update()
        )
        if db_session is None:
            raise LookupError("session not found")
        stored_turns = list(
            db.scalars(
                select(DbCoachTurn)
                .where(DbCoachTurn.session_id == session_id)
                .order_by(DbCoachTurn.turn_index)
            )
        )
        if len(session.turns) < len(stored_turns):
            raise SessionWriteConflict("session turns are stale")
        for stored, incoming in zip(stored_turns, session.turns, strict=False):
            if (
                stored.role.value != incoming.role
                or stored.text != incoming.text
                or stored.action != incoming.action
                or stored.focus_timestamp != incoming.focus_timestamp
            ):
                raise SessionWriteConflict("session turns changed concurrently")
        if db_session.status == SessionStatus.CLOSED and (
            session.status != SessionStatus.CLOSED.value
            or len(session.turns) > len(stored_turns)
        ):
            raise SessionWriteConflict("closed session changed concurrently")
        for index in range(len(stored_turns), len(session.turns)):
            db.add(PostgresStore._coach_turn(session_id, index, session.turns[index]))
        db_session.status = SessionStatus(session.status)
        db_session.close_reason = (
            CloseReason(session.close_reason) if session.close_reason else None
        )
        db_session.updated_at = now or datetime.now(timezone.utc)

    @staticmethod
    def _coach_turn(
        session_id: UUID, index: int, turn: AgentCoachTurn
    ) -> DbCoachTurn:
        return DbCoachTurn(
            session_id=session_id,
            turn_index=index,
            role=TurnRole(turn.role),
            text=turn.text,
            action=turn.action,
            focus_timestamp=turn.focus_timestamp,
        )

    # ---- reports ----

    def get_owned_report_context(
        self, *, user_id: UUID, coach_session_id: UUID
    ) -> OwnedReportContext | None:
        with self._session_factory() as db:
            data = self._load_session(
                db,
                coach_session_id,
                user_id=user_id,
                include_hidden=False,
            )
            if data is None:
                return None
            return OwnedReportContext(
                practice_session_id=data.practice_session_id,
                session=self._report_coach_session(data),
            )

    def has_report_for_practice_session(self, practice_session_id: UUID) -> bool:
        with self._session_factory() as db:
            return (
                db.scalar(
                    select(DbReport.id)
                    .join(
                        DbCoachSession,
                        DbReport.session_id == DbCoachSession.id,
                    )
                    .join(Summary, DbCoachSession.summary_id == Summary.id)
                    .where(Summary.session_id == practice_session_id)
                )
                is not None
            )

    @staticmethod
    def _add_report(
        db: Session,
        coach_session_id: UUID,
        report: ActingReport,
    ) -> None:
        db.add(
            DbReport(
                id=uuid4(),
                session_id=coach_session_id,
                headline=report.headline,
                biggest_problem=report.biggest_problem.model_dump(mode="json"),
                evidence=report.evidence,
                self_discovery=report.self_discovery,
                encouragement=report.encouragement,
                next_step=report.next_step,
                comparison=report.comparison,
            )
        )

    def list_reports(self, user_id: UUID) -> list[ReportRecord]:
        with self._session_factory() as db:
            reports = list(
                db.execute(
                    select(DbReport, PracticeSession.id)
                    .join(DbCoachSession, DbReport.session_id == DbCoachSession.id)
                    .join(Summary, DbCoachSession.summary_id == Summary.id)
                    .join(PracticeSession, Summary.session_id == PracticeSession.id)
                    .where(PracticeSession.user_id == user_id)
                    .order_by(DbReport.created_at, DbReport.id)
                )
            )
            return [
                ReportRecord(
                    created_at=report.created_at.isoformat(),
                    session_id=str(report.session_id),
                    practice_session_id=str(practice_session_id),
                    report=ActingReport(
                        headline=report.headline,
                        biggest_problem=BiggestProblem.model_validate(
                            report.biggest_problem
                        ),
                        evidence=report.evidence,
                        self_discovery=report.self_discovery,
                        encouragement=report.encouragement,
                        next_step=report.next_step,
                        comparison=report.comparison,
                    ),
                )
                for report, practice_session_id in reports
            ]

    @staticmethod
    def _is_duplicate_report_error(exc: IntegrityError) -> bool:
        original = exc.orig
        diagnostic = getattr(original, "diag", None)
        return (
            getattr(original, "sqlstate", None) == "23505"
            and getattr(diagnostic, "constraint_name", None)
            == "reports_session_id_key"
        )

    @staticmethod
    def _report_count_query(user_id: UUID):
        return (
            select(func.count(DbReport.id))
            .join(DbCoachSession, DbReport.session_id == DbCoachSession.id)
            .join(Summary, DbCoachSession.summary_id == Summary.id)
            .join(PracticeSession, Summary.session_id == PracticeSession.id)
            .where(PracticeSession.user_id == user_id)
        )

    # ---- external operations ----

    def get_external_operation(
        self, *, user_id: UUID, request_id: UUID
    ) -> ExternalOperation | None:
        with self._session_factory() as db:
            return db.scalar(
                select(ExternalOperation).where(
                    ExternalOperation.user_id == user_id,
                    ExternalOperation.request_id == request_id,
                )
            )

    def get_or_create_external_operation(
        self,
        *,
        user_id: UUID,
        session_id: UUID,
        request_id: UUID,
        kind: OperationKind | str,
        request_fingerprint: str,
    ) -> ExternalOperationLookup:
        self._validate_sha256(request_fingerprint)
        operation_id = uuid4()
        with self._session_factory.begin() as db:
            owned_session_id = db.scalar(
                select(PracticeSession.id).where(
                    PracticeSession.id == session_id,
                    PracticeSession.user_id == user_id,
                )
            )
            if owned_session_id is None:
                raise LookupError("practice session not found")
            inserted_id = db.scalar(
                insert(ExternalOperation)
                .values(
                    id=operation_id,
                    user_id=user_id,
                    session_id=session_id,
                    request_id=request_id,
                    kind=OperationKind(kind),
                    request_fingerprint=request_fingerprint,
                )
                .on_conflict_do_nothing(
                    index_elements=[
                        ExternalOperation.user_id,
                        ExternalOperation.request_id,
                    ]
                )
                .returning(ExternalOperation.id)
            )
            created = inserted_id is not None
            operation = (
                db.get(ExternalOperation, inserted_id)
                if created
                else db.scalar(
                    select(ExternalOperation).where(
                        ExternalOperation.user_id == user_id,
                        ExternalOperation.request_id == request_id,
                    )
                )
            )
            return ExternalOperationLookup(
                operation=operation,
                created=created,
                fingerprint_mismatch=(
                    operation.request_fingerprint != request_fingerprint
                ),
            )

    def claim_external_operation(
        self,
        *,
        operation_id: UUID,
        lease_token: UUID,
        lease_duration: timedelta,
        now: datetime | None = None,
        max_attempts: int = MAX_EXTERNAL_OPERATION_ATTEMPTS,
    ) -> ExternalOperation | None:
        now = now or datetime.now(timezone.utc)
        with self._session_factory.begin() as db:
            return db.scalars(
                update(ExternalOperation)
                .where(
                    ExternalOperation.id == operation_id,
                    ExternalOperation.attempt_count < max_attempts,
                    or_(
                        and_(
                            ExternalOperation.status == OperationStatus.PENDING,
                            ExternalOperation.lease_token.is_(None),
                        ),
                        and_(
                            ExternalOperation.status == OperationStatus.RUNNING,
                            ExternalOperation.lease_expires_at < now,
                        ),
                        and_(
                            ExternalOperation.status == OperationStatus.FAILED,
                            ExternalOperation.lease_token.is_(None),
                        ),
                    ),
                )
                .values(
                    status=OperationStatus.RUNNING,
                    attempt_count=ExternalOperation.attempt_count + 1,
                    lease_token=lease_token,
                    lease_expires_at=now + lease_duration,
                    error_code=None,
                    response_payload=None,
                    updated_at=now,
                )
                .returning(ExternalOperation)
            ).one_or_none()

    def claim_next_external_operation(
        self,
        *,
        kind: OperationKind | str,
        lease_token: UUID,
        lease_duration: timedelta,
        now: datetime | None = None,
        max_attempts: int = MAX_EXTERNAL_OPERATION_ATTEMPTS,
    ) -> ExternalOperation | None:
        now = now or datetime.now(timezone.utc)
        claimable = and_(
            ExternalOperation.kind == OperationKind(kind),
            ExternalOperation.attempt_count < max_attempts,
            or_(
                and_(
                    ExternalOperation.status == OperationStatus.PENDING,
                    ExternalOperation.lease_token.is_(None),
                ),
                and_(
                    ExternalOperation.status == OperationStatus.RUNNING,
                    ExternalOperation.lease_expires_at < now,
                ),
            ),
        )
        candidate_id = (
            select(ExternalOperation.id)
            .where(claimable)
            .order_by(ExternalOperation.created_at, ExternalOperation.id)
            .limit(1)
            .scalar_subquery()
        )
        with self._session_factory.begin() as db:
            operation = db.scalars(
                update(ExternalOperation)
                .where(ExternalOperation.id == candidate_id, claimable)
                .values(
                    status=OperationStatus.RUNNING,
                    attempt_count=ExternalOperation.attempt_count + 1,
                    lease_token=lease_token,
                    lease_expires_at=now + lease_duration,
                    error_code=None,
                    response_payload=None,
                    updated_at=now,
                )
                .returning(ExternalOperation)
            ).one_or_none()
            if operation is not None and OperationKind(kind) == OperationKind.ANALYZE:
                db.execute(
                    update(PracticeSession)
                    .where(PracticeSession.id == operation.session_id)
                    .values(status=PracticeStatus.ANALYZING, updated_at=now)
                )
            return operation

    def get_analysis_context(self, operation_id: UUID) -> AnalysisContext | None:
        with self._session_factory() as db:
            row = db.execute(
                select(ExternalOperation, PracticeSession, UploadIntent)
                .join(
                    PracticeSession,
                    ExternalOperation.session_id == PracticeSession.id,
                )
                .join(
                    UploadIntent,
                    PracticeSession.upload_intent_id == UploadIntent.id,
                )
                .where(
                    ExternalOperation.id == operation_id,
                    ExternalOperation.kind == OperationKind.ANALYZE,
                )
            ).one_or_none()
            if row is None:
                return None
            operation, session, upload = row
            return AnalysisContext(
                operation=operation,
                session=session,
                upload=upload,
            )

    def complete_coach_start_operation(
        self,
        *,
        operation_id: UUID,
        lease_token: UUID,
        coach_session: AgentCoachSession,
        response_payload: dict[str, Any],
        now: datetime | None = None,
    ) -> bool:
        now = now or datetime.now(timezone.utc)
        with self._session_factory.begin() as db:
            operation = db.get(ExternalOperation, operation_id)
            if operation is None:
                raise LookupError("external operation not found")
            if operation.kind != OperationKind.COACH_START:
                raise ValueError("coach start result requires a coach_start operation")
            self._add_coach_session(db, coach_session)
            if not self._finish_external_operation(
                db,
                operation_id=operation_id,
                lease_token=lease_token,
                status=OperationStatus.SUCCEEDED,
                response_payload=response_payload,
                error_code=None,
                now=now,
            ):
                raise LeaseOwnershipError("external operation lease is not owned")
            return True

    def complete_coach_reply_operation(
        self,
        *,
        operation_id: UUID,
        lease_token: UUID,
        coach_session: AgentCoachSession,
        response_payload: dict[str, Any],
        now: datetime | None = None,
    ) -> bool:
        now = now or datetime.now(timezone.utc)
        with self._session_factory.begin() as db:
            operation = db.get(ExternalOperation, operation_id)
            if operation is None:
                raise LookupError("external operation not found")
            if operation.kind != OperationKind.COACH_REPLY:
                raise ValueError("coach reply result requires a coach_reply operation")
            self._save_coach_session(db, coach_session, now=now)
            if not self._finish_external_operation(
                db,
                operation_id=operation_id,
                lease_token=lease_token,
                status=OperationStatus.SUCCEEDED,
                response_payload=response_payload,
                error_code=None,
                now=now,
            ):
                raise LeaseOwnershipError("external operation lease is not owned")
            return True

    def complete_report_operation(
        self,
        *,
        operation_id: UUID,
        lease_token: UUID,
        coach_session_id: UUID,
        report: ActingReport,
        now: datetime | None = None,
    ) -> dict[str, Any] | None:
        now = now or datetime.now(timezone.utc)
        db = self._session_factory()
        try:
            with db.begin():
                operation = db.get(ExternalOperation, operation_id)
                if operation is None:
                    raise LookupError("external operation not found")
                if operation.kind != OperationKind.REPORT:
                    raise ValueError("report result requires a report operation")
                practice_session_id = db.scalar(
                    select(PracticeSession.id)
                    .where(PracticeSession.id == operation.session_id)
                    .with_for_update()
                )
                if practice_session_id is None:
                    raise LookupError("practice session not found")
                existing_report_id = db.scalar(
                    select(DbReport.id)
                    .join(
                        DbCoachSession,
                        DbReport.session_id == DbCoachSession.id,
                    )
                    .join(Summary, DbCoachSession.summary_id == Summary.id)
                    .where(Summary.session_id == practice_session_id)
                )
                if existing_report_id is not None:
                    return None
                self._add_report(db, coach_session_id, report)
                db.flush()
                payload = {
                    "report": report.model_dump(mode="json"),
                    "report_count": db.scalar(
                        self._report_count_query(operation.user_id)
                    )
                    or 0,
                }
                if not self._finish_external_operation(
                    db,
                    operation_id=operation_id,
                    lease_token=lease_token,
                    status=OperationStatus.SUCCEEDED,
                    response_payload=payload,
                    error_code=None,
                    now=now,
                ):
                    raise LeaseOwnershipError(
                        "external operation lease is not owned"
                    )
                return payload
        except IntegrityError as exc:
            if self._is_duplicate_report_error(exc):
                return None
            raise
        finally:
            db.close()

    def complete_analysis_operation(
        self,
        *,
        operation_id: UUID,
        lease_token: UUID,
        summary: SummarySceneSummary,
        model: str,
        was_compressed: bool,
        response_payload: dict[str, Any],
        now: datetime | None = None,
    ) -> UUID:
        now = now or datetime.now(timezone.utc)
        summary_id = uuid4()
        with self._session_factory.begin() as db:
            operation = db.get(ExternalOperation, operation_id)
            if operation is None:
                raise LookupError("external operation not found")
            if operation.kind != OperationKind.ANALYZE:
                raise ValueError("analysis results require an analyze operation")
            self._add_summary(
                db,
                summary_id=summary_id,
                session_id=operation.session_id,
                summary=summary,
                model=model,
                was_compressed=was_compressed,
            )
            db.execute(
                update(PracticeSession)
                .where(PracticeSession.id == operation.session_id)
                .values(status=PracticeStatus.ANALYZED, updated_at=now)
            )
            payload = dict(response_payload)
            payload.setdefault("summary_id", str(summary_id))
            if not self._finish_external_operation(
                db,
                operation_id=operation_id,
                lease_token=lease_token,
                status=OperationStatus.SUCCEEDED,
                response_payload=payload,
                error_code=None,
                now=now,
            ):
                raise LeaseOwnershipError("external operation lease is not owned")
        return summary_id

    def fail_external_operation(
        self,
        *,
        operation_id: UUID,
        lease_token: UUID,
        error_code: str,
        fail_session: bool = False,
        now: datetime | None = None,
    ) -> bool:
        now = now or datetime.now(timezone.utc)
        with self._session_factory.begin() as db:
            operation = db.get(ExternalOperation, operation_id)
            if operation is None:
                return False
            if fail_session:
                db.execute(
                    update(PracticeSession)
                    .where(PracticeSession.id == operation.session_id)
                    .values(status=PracticeStatus.FAILED, updated_at=now)
                )
            if not self._finish_external_operation(
                db,
                operation_id=operation_id,
                lease_token=lease_token,
                status=OperationStatus.FAILED,
                response_payload=None,
                error_code=error_code,
                now=now,
            ):
                raise LeaseOwnershipError("external operation lease is not owned")
            return True

    def release_external_operation(
        self,
        *,
        operation_id: UUID,
        lease_token: UUID,
        now: datetime | None = None,
    ) -> bool:
        now = now or datetime.now(timezone.utc)
        with self._session_factory.begin() as db:
            released = db.execute(
                update(ExternalOperation)
                .where(
                    ExternalOperation.id == operation_id,
                    ExternalOperation.status == OperationStatus.RUNNING,
                    ExternalOperation.lease_token == lease_token,
                )
                .values(
                    status=OperationStatus.PENDING,
                    response_payload=None,
                    error_code=None,
                    lease_token=None,
                    lease_expires_at=None,
                    updated_at=now,
                )
            )
            if not released.rowcount:
                raise LeaseOwnershipError("external operation lease is not owned")
            return True

    def sweep_max_attempts_operations(
        self,
        *,
        now: datetime | None = None,
        max_attempts: int = MAX_EXTERNAL_OPERATION_ATTEMPTS,
    ) -> int:
        now = now or datetime.now(timezone.utc)
        with self._session_factory.begin() as db:
            swept = db.execute(
                update(ExternalOperation)
                .where(
                    ExternalOperation.status.in_(
                        (
                            OperationStatus.PENDING,
                            OperationStatus.RUNNING,
                            OperationStatus.FAILED,
                        )
                    ),
                    ExternalOperation.attempt_count >= max_attempts,
                    or_(
                        ExternalOperation.error_code.is_(None),
                        ExternalOperation.error_code != "max_attempts_exceeded",
                    ),
                    or_(
                        ExternalOperation.lease_token.is_(None),
                        ExternalOperation.lease_expires_at < now,
                    ),
                )
                .values(
                    status=OperationStatus.FAILED,
                    error_code="max_attempts_exceeded",
                    response_payload=None,
                    lease_token=None,
                    lease_expires_at=None,
                    updated_at=now,
                )
                .returning(ExternalOperation.session_id, ExternalOperation.kind)
            )
            swept_rows = list(swept)
            analyze_session_ids = [
                session_id
                for session_id, kind in swept_rows
                if kind == OperationKind.ANALYZE
            ]
            if analyze_session_ids:
                db.execute(
                    update(PracticeSession)
                    .where(
                        PracticeSession.id.in_(analyze_session_ids),
                        PracticeSession.status == PracticeStatus.ANALYZING,
                    )
                    .values(status=PracticeStatus.FAILED, updated_at=now)
                )
            return len(swept_rows)

    @staticmethod
    def _finish_external_operation(
        db: Session,
        *,
        operation_id: UUID,
        lease_token: UUID,
        status: OperationStatus,
        response_payload: dict[str, Any] | None,
        error_code: str | None,
        now: datetime,
    ) -> bool:
        result = db.execute(
            update(ExternalOperation)
            .where(
                ExternalOperation.id == operation_id,
                ExternalOperation.status == OperationStatus.RUNNING,
                ExternalOperation.lease_token == lease_token,
            )
            .values(
                status=status,
                response_payload=response_payload,
                error_code=error_code,
                lease_token=None,
                lease_expires_at=None,
                updated_at=now,
            )
        )
        return bool(result.rowcount)

    @staticmethod
    def _add_summary(
        db: Session,
        *,
        summary_id: UUID,
        session_id: UUID,
        summary: SummarySceneSummary,
        model: str,
        was_compressed: bool,
    ) -> None:
        raw = summary.model_dump(mode="json")
        db.add(
            Summary(
                id=summary_id,
                session_id=session_id,
                observation=raw["observation"],
                summary=summary.summary,
                intent_alignment=summary.intent_alignment,
                key_moment=summary.key_moment,
                key_dimension=summary.key_dimension,
                model=model,
                was_compressed=was_compressed,
                raw=raw,
            )
        )
        db.flush()
        for sort_order, anomaly in enumerate(raw["anomalies"]):
            db.add(
                DbAnomaly(
                    summary_id=summary_id,
                    sort_order=sort_order,
                    start_ts=anomaly["start"],
                    end_ts=anomaly["end"],
                    dimension=anomaly["dimension"],
                    what=anomaly["what"],
                    why_odd=anomaly["why_odd"],
                    likely_cause=anomaly["likely_cause"],
                    impact_on_intent=anomaly["impact_on_intent"],
                    overlaps_key_moment=anomaly["overlaps_key_moment"],
                    on_key_dimension=anomaly["on_key_dimension"],
                    intent_impact=IntentImpact(anomaly["intent_impact"]),
                    severity=Severity(anomaly["severity"]),
                    severity_reason=anomaly["severity_reason"],
                )
            )

    @staticmethod
    def _load_session(
        db: Session,
        session_id: UUID,
        *,
        user_id: UUID | None = None,
        include_hidden: bool = True,
    ) -> _SessionData | None:
        query = (
            select(
                DbCoachSession,
                Summary.raw,
                PracticeSession.id,
                PracticeSession.user_id,
                PracticeSession.situation,
                PracticeSession.character_context,
                PracticeSession.subtext,
            )
            .join(Summary, DbCoachSession.summary_id == Summary.id)
            .join(PracticeSession, Summary.session_id == PracticeSession.id)
            .where(DbCoachSession.id == session_id)
            .with_for_update(read=True, of=DbCoachSession)
        )
        if user_id is not None:
            query = query.where(PracticeSession.user_id == user_id)
        if not include_hidden:
            query = query.where(PracticeSession.hidden_at.is_(None))
        row = db.execute(query).one_or_none()
        if row is None:
            return None
        (
            db_session,
            raw,
            practice_session_id,
            user_id,
            situation,
            character_context,
            subtext,
        ) = row
        turns = list(
            db.scalars(
                select(DbCoachTurn)
                .where(DbCoachTurn.session_id == session_id)
                .order_by(DbCoachTurn.turn_index)
            )
        )
        return _SessionData(
            practice_session_id=practice_session_id,
            session_id=db_session.id,
            summary_id=db_session.summary_id,
            user_id=user_id,
            raw_summary=raw,
            situation=situation,
            character_context=character_context,
            subtext=subtext,
            status=db_session.status.value,
            close_reason=(
                db_session.close_reason.value if db_session.close_reason else ""
            ),
            turns=turns,
        )

    @staticmethod
    def _agent_coach_session(data: _SessionData) -> AgentCoachSession:
        return AgentCoachSession(
            session_id=str(data.session_id),
            summary_id=str(data.summary_id),
            summary=AgentSceneSummary.model_validate(data.raw_summary),
            subtext=AgentSubText(
                situation=data.situation,
                character=data.character_context,
                subtext=data.subtext,
            ),
            turns=[
                AgentCoachTurn(
                    role=turn.role.value,
                    text=turn.text,
                    action=turn.action,
                    focus_timestamp=turn.focus_timestamp,
                )
                for turn in data.turns
            ],
            question_count=data.question_count,
            status=data.status,
            close_reason=data.close_reason,
        )

    @staticmethod
    def _report_coach_session(data: _SessionData) -> ReportCoachSession:
        return ReportCoachSession(
            session_id=str(data.session_id),
            summary=ReportSceneSummary.model_validate(data.raw_summary),
            subtext=ReportSubText(
                situation=data.situation,
                character=data.character_context,
                subtext=data.subtext,
            ),
            turns=[
                ReportCoachTurn(role=turn.role.value, text=turn.text)
                for turn in data.turns
            ],
            question_count=data.question_count,
            status=data.status,
            close_reason=data.close_reason,
        )

    @staticmethod
    def _validate_sha256(value: str) -> None:
        if len(value) != 64:
            raise ValueError("SHA-256 values must be 64 hexadecimal characters")
        try:
            int(value, 16)
        except ValueError as exc:
            raise ValueError(
                "SHA-256 values must be 64 hexadecimal characters"
            ) from exc
