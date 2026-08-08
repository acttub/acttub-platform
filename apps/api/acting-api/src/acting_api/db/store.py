from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import Engine, and_, delete, func, or_, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session, sessionmaker

from acting_agent.schema import CoachSession as AgentCoachSession
from acting_agent.schema import CoachTurn as AgentCoachTurn
from acting_agent.store import SessionWriteConflict
from acting_agent.summary_schema import ActorMaterial as AgentActorMaterial
from acting_agent.summary_schema import ObservationPack as AgentObservationPack
from acting_api.db.engine import create_db_engine, create_session_factory
from acting_api.db.models import (
    CoachingHandoff,
    CoachSession as DbCoachSession,
    CoachTurn as DbCoachTurn,
    ConsentAction,
    ConsentDocument,
    ConsentType,
    ExternalOperation,
    HandoffConfirmation,
    IdentityProvider,
    OperationKind,
    OperationStatus,
    PracticeSession,
    PracticeReport as DbPracticeReport,
    PracticeStatus,
    RefreshToken,
    SessionStatus,
    Summary,
    Transcript,
    TurnRole,
    UploadIntent,
    UploadStatus,
    User,
    UserConsent,
    UserIdentity,
    UserStatus,
)
from acting_summary.schema import ObservationPack as SummaryObservationPack

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
class PracticeSessionStatusView:
    status: str
    error_code: str | None


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
class OwnedPracticeSessionContext:
    practice_session_id: UUID
    summary_id: UUID | None
    observation_pack: AgentObservationPack | None
    actor: AgentActorMaterial
    sub_branch: str
    transcripts: tuple[str, ...]
    analysis_handoff: dict[str, Any] | None


@dataclass(frozen=True)
class OwnedCoachSessionContext:
    practice_session_id: UUID
    session: AgentCoachSession


@dataclass(frozen=True)
class OwnedReportSource:
    practice_session_id: UUID
    coach_session_id: UUID
    video_summary: dict[str, Any]
    branch_kind: str
    handoff_id: UUID | None
    handoff_json: dict[str, Any] | None
    confirmed: bool
    analysis_handoff_id: UUID | None
    analysis_handoff_json: dict[str, Any] | None


@dataclass(frozen=True)
class PracticeReportSummary:
    practice_session_id: UUID
    report_type: str
    title: str
    created_at: datetime


@dataclass(frozen=True)
class PracticeReportDetail:
    practice_session_id: UUID
    created_at: datetime
    report: dict[str, Any]
    object_key: str


@dataclass(frozen=True)
class _SessionData:
    practice_session_id: UUID
    session_id: UUID
    summary_id: UUID | None
    user_id: UUID
    observation_pack: dict[str, Any] | None
    situation: str
    character_context: str
    goal: str
    duration_ms: int
    blockage_kind: str
    sub_branch: str
    blockage_detail: str | None
    transcripts: tuple[str, ...]
    conversation_summary: str
    analysis_handoff: dict[str, Any] | None
    status: str
    close_reason: str
    turns: list[DbCoachTurn]


class PostgresStore:
    def __init__(self, engine: Engine):
        self._engine = engine
        self._session_factory: sessionmaker[Session] = create_session_factory(engine)

    @classmethod
    def from_url(cls, database_url: str) -> PostgresStore:
        return cls(create_db_engine(database_url, pool_pre_ping=True))

    @property
    def engine(self) -> Engine:
        """다른 스토어가 같은 연결 풀을 쓰도록 열어 둔다 (CommunityStore 등)."""
        return self._engine

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

    def update_user_nickname(self, user_id: UUID, nickname: str) -> User | None:
        with self._session_factory.begin() as db:
            row = db.get(User, user_id)
            if row is None:
                return None
            row.nickname = nickname
            row.updated_at = func.now()
            db.flush()
            db.refresh(row)
            db.expunge(row)
            return row

    def deactivate_user(
        self, user_id: UUID, *, now: datetime | None = None
    ) -> User | None:
        """탈퇴 처리. 행은 남기고 개인정보만 파기한다.

        행을 통째로 지우지 않는 이유: 커뮤니티 글·연습 기록이 user_id 를 참조한다.
        지우면 남의 글타래가 깨지고 신고 처리에도 원문 작성자가 필요하다.

        대신 개인을 식별하는 것은 전부 지운다 — 개인정보처리방침이 "탈퇴하면 지체
        없이 파기한다" 고 약속했고(`consent_docs/privacy_v2.md`), 방침을 고쳐도
        파기 의무 자체는 남는다. **여기서 지운 이메일·닉네임은 복구할 수 없다.**

        identity 까지 지우므로 같은 소셜 계정으로 다시 가입할 수 있다. 새 user 가
        생기고 과거 기록과는 이어지지 않는다.

        상태 전환·파기·토큰 폐기를 한 트랜잭션에 묶는다. 나눠 놓으면 사이에서
        실패했을 때 "탈퇴했는데 refresh 는 살아 있는" 계정이 남는다.
        """
        now = now or datetime.now(timezone.utc)
        with self._session_factory.begin() as db:
            row = db.get(User, user_id)
            if row is None:
                return None
            if row.status is not UserStatus.DEACTIVATED:
                # 이미 탈퇴한 계정이면 최초 탈퇴 시각을 유지한다.
                row.status = UserStatus.DEACTIVATED
                row.deactivated_at = now
                row.updated_at = now
            row.email = None
            row.nickname = None
            db.execute(delete(UserIdentity).where(UserIdentity.user_id == user_id))
            db.execute(
                update(RefreshToken)
                .where(
                    RefreshToken.user_id == user_id,
                    RefreshToken.revoked_at.is_(None),
                )
                .values(revoked_at=now)
            )
            db.flush()
            db.refresh(row)
            db.expunge(row)
            return row

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

    def get_consent_document_by_type_version(
        self, type: ConsentType | str, version: str
    ) -> ConsentDocument | None:
        with self._session_factory() as db:
            return db.scalar(
                select(ConsentDocument).where(
                    ConsentDocument.type == ConsentType(type),
                    ConsentDocument.version == version,
                )
            )

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

    def has_pending_required_consents(self, user_id: UUID) -> bool:
        actions = {
            event.document_id: getattr(event.action, "value", event.action)
            for event in self.get_current_user_consents(user_id)
        }
        return any(
            document.required and actions.get(document.id) != "granted"
            for document in self.list_latest_consent_documents()
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
        goal: str,
        blockage_kind: str = "그 외",
        sub_branch: str = "그 외",
        blockage_detail: str | None = None,
        status: PracticeStatus | str = PracticeStatus.CREATED,
    ) -> PracticeSession | None:
        row = PracticeSession(
            id=uuid4(),
            user_id=user_id,
            upload_intent_id=upload_intent_id,
            status=PracticeStatus(status),
            situation=situation,
            character_context=character_context,
            goal=goal,
            subtext=None,
            blockage_kind=blockage_kind,
            sub_branch=sub_branch,
            blockage_detail=blockage_detail,
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
        goal: str,
        blockage_kind: str = "그 외",
        sub_branch: str = "그 외",
        blockage_detail: str | None = None,
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
            session = PracticeSession(
                id=uuid4(),
                user_id=user_id,
                upload_intent_id=upload_intent_id,
                status=PracticeStatus.ANALYZING,
                situation=situation,
                character_context=character_context,
                goal=goal,
                subtext=None,
                blockage_kind=blockage_kind,
                sub_branch=sub_branch,
                blockage_detail=blockage_detail,
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

    def get_practice_session_status(
        self, *, user_id: UUID, session_id: UUID
    ) -> PracticeSessionStatusView | None:
        with self._session_factory() as db:
            session_status = db.scalar(
                select(PracticeSession.status).where(
                    PracticeSession.id == session_id,
                    PracticeSession.user_id == user_id,
                    PracticeSession.hidden_at.is_(None),
                )
            )
            if session_status is None:
                return None
            status_value = getattr(session_status, "value", session_status)
            error_code = None
            if session_status == PracticeStatus.FAILED:
                error_code = db.scalar(
                    select(ExternalOperation.error_code)
                    .where(
                        ExternalOperation.session_id == session_id,
                        ExternalOperation.kind == OperationKind.ANALYZE,
                    )
                    .order_by(
                        ExternalOperation.created_at.desc(),
                        ExternalOperation.id.desc(),
                    )
                    .limit(1)
                )
            return PracticeSessionStatusView(
                status=status_value,
                error_code=error_code,
            )

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

    # ---- coaching input ----

    @staticmethod
    def _confirmed_analysis_handoff(
        db: Session,
        *,
        user_id: UUID,
        upload_intent_id: UUID,
    ) -> dict[str, Any] | None:
        return db.scalar(
            select(CoachingHandoff.handoff_json)
            .join(
                HandoffConfirmation,
                HandoffConfirmation.coaching_handoff_id == CoachingHandoff.id,
            )
            .join(
                PracticeSession,
                CoachingHandoff.practice_session_id == PracticeSession.id,
            )
            .where(
                PracticeSession.user_id == user_id,
                PracticeSession.upload_intent_id == upload_intent_id,
                CoachingHandoff.branch_kind == "analysis",
                HandoffConfirmation.confirmed.is_(True),
            )
            .order_by(CoachingHandoff.created_at.desc(), CoachingHandoff.id.desc())
            .limit(1)
        )

    def get_owned_practice_session_context(
        self, *, user_id: UUID, practice_session_id: UUID
    ) -> OwnedPracticeSessionContext | None:
        with self._session_factory() as db:
            row = db.execute(
                select(
                    PracticeSession.id,
                    Summary.id,
                    Summary.observations_json,
                    Summary.uncertainties_json,
                    PracticeSession.situation,
                    PracticeSession.character_context,
                    PracticeSession.goal,
                    PracticeSession.blockage_kind,
                    PracticeSession.sub_branch,
                    PracticeSession.blockage_detail,
                    PracticeSession.upload_intent_id,
                    UploadIntent.duration_ms,
                )
                .outerjoin(Summary, Summary.session_id == PracticeSession.id)
                .join(UploadIntent, UploadIntent.id == PracticeSession.upload_intent_id)
                .where(
                    PracticeSession.id == practice_session_id,
                    PracticeSession.user_id == user_id,
                    PracticeSession.hidden_at.is_(None),
                )
            ).one_or_none()
            if row is None:
                return None
            (
                practice_session_id,
                summary_id,
                observations,
                uncertainties,
                situation,
                character_context,
                goal,
                blockage_kind,
                sub_branch,
                blockage_detail,
                upload_intent_id,
                duration_ms,
            ) = row
            return OwnedPracticeSessionContext(
                practice_session_id=practice_session_id,
                summary_id=summary_id,
                observation_pack=(
                    AgentObservationPack(
                        observations=observations,
                        uncertainties=uncertainties,
                    )
                    if summary_id is not None
                    else None
                ),
                actor=AgentActorMaterial(
                    situation=situation,
                    character=character_context,
                    goal=goal,
                    blockage_kind=blockage_kind,
                    blockage_detail=blockage_detail or "",
                    duration_ms=duration_ms or 0,
                ),
                sub_branch=sub_branch,
                transcripts=tuple(
                    db.scalars(
                        select(Transcript.text)
                        .where(Transcript.session_id == practice_session_id)
                        .order_by(Transcript.ord)
                    )
                ),
                analysis_handoff=(
                    self._confirmed_analysis_handoff(
                        db,
                        user_id=user_id,
                        upload_intent_id=upload_intent_id,
                    )
                    if blockage_kind == "표현"
                    else None
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

    def get_oldest_open_coach_session(
        self, *, user_id: UUID, practice_session_id: UUID
    ) -> OwnedCoachSessionContext | None:
        with self._session_factory() as db:
            coach_session_id = db.scalar(
                select(DbCoachSession.id)
                .join(
                    PracticeSession,
                    DbCoachSession.practice_session_id == PracticeSession.id,
                )
                .where(
                    DbCoachSession.practice_session_id == practice_session_id,
                    DbCoachSession.status == SessionStatus.OPEN,
                    PracticeSession.user_id == user_id,
                    PracticeSession.hidden_at.is_(None),
                )
                .order_by(DbCoachSession.created_at, DbCoachSession.id)
                .limit(1)
            )
            if coach_session_id is None:
                return None
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
                practice_session_id=UUID(session.practice_session_id),
                summary_id=(
                    UUID(session.summary_id) if session.summary_id is not None else None
                ),
                status=SessionStatus(session.status),
                close_reason=None,
                conversation_summary=session.conversation_summary,
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
        db_session.conversation_summary = session.conversation_summary
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
        )

    # ---- coaching handoffs and reports ----

    @staticmethod
    def _owned_report_source(
        db: Session,
        *,
        user_id: UUID,
        coach_session_id: UUID,
    ) -> OwnedReportSource | None:
        data = PostgresStore._load_session(
            db,
            coach_session_id,
            user_id=user_id,
            include_hidden=False,
        )
        if data is None:
            return None
        latest = db.execute(
            select(CoachingHandoff, HandoffConfirmation.confirmed)
            .outerjoin(
                HandoffConfirmation,
                HandoffConfirmation.coaching_handoff_id == CoachingHandoff.id,
            )
            .where(CoachingHandoff.coach_session_id == coach_session_id)
            .order_by(CoachingHandoff.created_at.desc(), CoachingHandoff.id.desc())
            .limit(1)
        ).first()
        handoff = latest[0] if latest else None
        confirmed = bool(latest and latest[1] is True)
        branch_kind = (
            handoff.branch_kind
            if handoff is not None
            else ("expression" if data.blockage_kind == "표현" else "analysis")
        )
        analysis = None
        if branch_kind == "expression":
            analysis = db.scalar(
                select(CoachingHandoff)
                .join(
                    HandoffConfirmation,
                    HandoffConfirmation.coaching_handoff_id
                    == CoachingHandoff.id,
                )
                .where(
                    CoachingHandoff.practice_session_id
                    == data.practice_session_id,
                    CoachingHandoff.branch_kind == "analysis",
                    HandoffConfirmation.confirmed.is_(True),
                )
                .order_by(
                    CoachingHandoff.created_at.desc(), CoachingHandoff.id.desc()
                )
                .limit(1)
            )
        return OwnedReportSource(
            practice_session_id=data.practice_session_id,
            coach_session_id=data.session_id,
            video_summary=data.observation_pack
            or {"observations": [], "uncertainties": []},
            branch_kind=branch_kind,
            handoff_id=handoff.id if handoff is not None else None,
            handoff_json=handoff.handoff_json if handoff is not None else None,
            confirmed=confirmed,
            analysis_handoff_id=analysis.id if analysis is not None else None,
            analysis_handoff_json=(
                analysis.handoff_json if analysis is not None else None
            ),
        )

    def get_owned_report_source(
        self, *, user_id: UUID, coach_session_id: UUID
    ) -> OwnedReportSource | None:
        with self._session_factory() as db:
            return self._owned_report_source(
                db,
                user_id=user_id,
                coach_session_id=coach_session_id,
            )

    def confirm_latest_handoff(
        self,
        *,
        user_id: UUID,
        coach_session_id: UUID,
        confirmed: bool,
        rebuttal_text: str | None,
        now: datetime | None = None,
    ) -> OwnedReportSource | None:
        now = now or datetime.now(timezone.utc)
        with self._session_factory.begin() as db:
            source = self._owned_report_source(
                db,
                user_id=user_id,
                coach_session_id=coach_session_id,
            )
            if source is None or source.handoff_id is None:
                return source
            db.execute(
                insert(HandoffConfirmation)
                .values(
                    coaching_handoff_id=source.handoff_id,
                    confirmed=confirmed,
                    rebuttal_text=rebuttal_text,
                    updated_at=now,
                )
                .on_conflict_do_update(
                    index_elements=[HandoffConfirmation.coaching_handoff_id],
                    set_={
                        "confirmed": confirmed,
                        "rebuttal_text": rebuttal_text,
                        "updated_at": now,
                    },
                )
            )
            if confirmed:
                db.execute(
                    update(DbCoachSession)
                    .where(DbCoachSession.id == coach_session_id)
                    .values(status=SessionStatus.CLOSED, updated_at=now)
                )
            return replace(source, confirmed=confirmed)

    def has_report_for_practice_session(self, practice_session_id: UUID) -> bool:
        with self._session_factory() as db:
            return (
                db.scalar(
                    select(DbPracticeReport.id).where(
                        DbPracticeReport.practice_session_id == practice_session_id
                    )
                )
                is not None
            )

    def list_report_summaries(self, user_id: UUID) -> list[PracticeReportSummary]:
        with self._session_factory() as db:
            rows = db.execute(
                select(DbPracticeReport, PracticeSession.id)
                .join(
                    PracticeSession,
                    DbPracticeReport.practice_session_id == PracticeSession.id,
                )
                .where(
                    PracticeSession.user_id == user_id,
                    PracticeSession.hidden_at.is_(None),
                )
                .order_by(DbPracticeReport.created_at, DbPracticeReport.id)
            )
            return [
                PracticeReportSummary(
                    practice_session_id=practice_session_id,
                    report_type=report.report_type,
                    title=str(report.report_json.get("title", "")),
                    created_at=report.created_at,
                )
                for report, practice_session_id in rows
            ]

    def get_report_detail_for_practice_session(
        self,
        *,
        user_id: UUID,
        practice_session_id: UUID,
    ) -> PracticeReportDetail | None:
        with self._session_factory() as db:
            row = db.execute(
                select(
                    DbPracticeReport,
                    PracticeSession.id,
                    UploadIntent.object_key,
                )
                .join(
                    PracticeSession,
                    DbPracticeReport.practice_session_id == PracticeSession.id,
                )
                .join(
                    UploadIntent,
                    PracticeSession.upload_intent_id == UploadIntent.id,
                )
                .where(
                    PracticeSession.user_id == user_id,
                    PracticeSession.id == practice_session_id,
                    PracticeSession.hidden_at.is_(None),
                )
                .order_by(
                    DbPracticeReport.created_at.desc(),
                    DbPracticeReport.id.desc(),
                )
                .limit(1)
            ).first()
            if row is None:
                return None
            report, row_practice_session_id, object_key = row
            return PracticeReportDetail(
                practice_session_id=row_practice_session_id,
                created_at=report.created_at,
                report=report.report_json,
                object_key=object_key,
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
        handoff_id: UUID | None = None,
        branch_kind: str | None = None,
        handoff_json: dict[str, Any] | None = None,
        confirmed: bool = False,
        report_json: dict[str, Any] | None = None,
        restart: bool = False,
        now: datetime | None = None,
    ) -> bool:
        now = now or datetime.now(timezone.utc)
        with self._session_factory.begin() as db:
            operation = db.get(ExternalOperation, operation_id)
            if operation is None:
                raise LookupError("external operation not found")
            if operation.kind != OperationKind.COACH_START:
                raise ValueError("coach start result requires a coach_start operation")
            if confirmed:
                coach_session.status = "closed"
            if restart:
                db.execute(
                    update(DbCoachSession)
                    .where(
                        DbCoachSession.practice_session_id == operation.session_id,
                        DbCoachSession.status == SessionStatus.OPEN,
                    )
                    .values(status=SessionStatus.CLOSED, updated_at=now)
                )
            self._add_coach_session(db, coach_session)
            if handoff_id and branch_kind and handoff_json is not None:
                db.add(
                    CoachingHandoff(
                        id=handoff_id,
                        coach_session_id=UUID(coach_session.session_id),
                        practice_session_id=operation.session_id,
                        branch_kind=branch_kind,
                        handoff_json=handoff_json,
                    )
                )
                if confirmed:
                    db.add(
                        HandoffConfirmation(
                            coaching_handoff_id=handoff_id,
                            confirmed=True,
                            rebuttal_text=None,
                            created_at=now,
                            updated_at=now,
                        )
                    )
                if (
                    report_json is not None
                    and report_json["report_type"] != "blocked"
                ):
                    db.add(
                        DbPracticeReport(
                            id=uuid4(),
                            practice_session_id=operation.session_id,
                            report_type=report_json["report_type"],
                            report_json=report_json,
                            source_handoff_id=handoff_id,
                            created_at=now,
                        )
                    )
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
        handoff_id: UUID | None = None,
        branch_kind: str | None = None,
        handoff_json: dict[str, Any] | None = None,
        confirmed: bool = False,
        report_json: dict[str, Any] | None = None,
        now: datetime | None = None,
    ) -> bool:
        now = now or datetime.now(timezone.utc)
        with self._session_factory.begin() as db:
            operation = db.get(ExternalOperation, operation_id)
            if operation is None:
                raise LookupError("external operation not found")
            if operation.kind != OperationKind.COACH_REPLY:
                raise ValueError("coach reply result requires a coach_reply operation")
            if confirmed:
                coach_session.status = "closed"
            self._save_coach_session(db, coach_session, now=now)
            if handoff_id and branch_kind and handoff_json is not None:
                db.add(
                    CoachingHandoff(
                        id=handoff_id,
                        coach_session_id=UUID(coach_session.session_id),
                        practice_session_id=operation.session_id,
                        branch_kind=branch_kind,
                        handoff_json=handoff_json,
                    )
                )
                if confirmed:
                    db.add(
                        HandoffConfirmation(
                            coaching_handoff_id=handoff_id,
                            confirmed=True,
                            rebuttal_text=None,
                            created_at=now,
                            updated_at=now,
                        )
                    )
                if (
                    report_json is not None
                    and report_json["report_type"] != "blocked"
                ):
                    db.add(
                        DbPracticeReport(
                            id=uuid4(),
                            practice_session_id=operation.session_id,
                            report_type=report_json["report_type"],
                            report_json=report_json,
                            source_handoff_id=handoff_id,
                            created_at=now,
                        )
                    )
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

    def complete_sync_operation(
        self,
        *,
        operation_id: UUID,
        lease_token: UUID,
        response_payload: dict[str, Any],
        now: datetime | None = None,
    ) -> bool:
        now = now or datetime.now(timezone.utc)
        with self._session_factory.begin() as db:
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

    def get_practice_report_for_handoff(
        self, source_handoff_id: UUID
    ) -> dict[str, Any] | None:
        with self._session_factory() as db:
            report = db.scalar(
                select(DbPracticeReport).where(
                    DbPracticeReport.source_handoff_id == source_handoff_id
                )
            )
            return report.report_json if report is not None else None

    def complete_practice_report_operation(
        self,
        *,
        operation_id: UUID,
        lease_token: UUID,
        practice_session_id: UUID,
        report_type: str,
        report_json: dict[str, Any],
        source_handoff_id: UUID,
        response_payload: dict[str, Any],
        now: datetime | None = None,
    ) -> bool:
        now = now or datetime.now(timezone.utc)
        with self._session_factory.begin() as db:
            inserted_id = db.scalar(
                insert(DbPracticeReport)
                .values(
                    id=uuid4(),
                    practice_session_id=practice_session_id,
                    report_type=report_type,
                    report_json=report_json,
                    source_handoff_id=source_handoff_id,
                    created_at=now,
                )
                .on_conflict_do_nothing(
                    index_elements=[DbPracticeReport.source_handoff_id]
                )
                .returning(DbPracticeReport.id)
            )
            if inserted_id is None:
                return False
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

    def complete_analysis_operation(
        self,
        *,
        operation_id: UUID,
        lease_token: UUID,
        observation_pack: SummaryObservationPack,
        model: str,
        was_compressed: bool,
        response_payload: dict[str, Any],
        transcripts: tuple[str, ...] | list[str] = (),
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
                observation_pack=observation_pack,
                model=model,
                was_compressed=was_compressed,
            )
            for order, text in enumerate(transcripts):
                db.add(
                    Transcript(
                        session_id=operation.session_id,
                        ord=order,
                        text=text,
                    )
                )
            db.execute(
                update(PracticeSession)
                .where(PracticeSession.id == operation.session_id)
                .values(status=PracticeStatus.ANALYZED, updated_at=now)
            )
            db.execute(
                update(DbCoachSession)
                .where(
                    DbCoachSession.practice_session_id == operation.session_id,
                    DbCoachSession.summary_id.is_(None),
                )
                .values(summary_id=summary_id, updated_at=now)
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
        observation_pack: SummaryObservationPack,
        model: str,
        was_compressed: bool,
    ) -> None:
        raw = observation_pack.model_dump(mode="json")
        db.add(
            Summary(
                id=summary_id,
                session_id=session_id,
                observations_json=raw["observations"],
                uncertainties_json=raw["uncertainties"],
                model=model,
                was_compressed=was_compressed,
                raw=raw,
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
                Summary.id,
                Summary.observations_json,
                Summary.uncertainties_json,
                PracticeSession.id,
                PracticeSession.user_id,
                PracticeSession.situation,
                PracticeSession.character_context,
                PracticeSession.goal,
                PracticeSession.blockage_kind,
                PracticeSession.sub_branch,
                PracticeSession.blockage_detail,
                PracticeSession.upload_intent_id,
                UploadIntent.duration_ms,
            )
            .join(
                PracticeSession,
                DbCoachSession.practice_session_id == PracticeSession.id,
            )
            .outerjoin(Summary, Summary.session_id == PracticeSession.id)
            .join(UploadIntent, UploadIntent.id == PracticeSession.upload_intent_id)
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
            summary_id,
            observations,
            uncertainties,
            practice_session_id,
            user_id,
            situation,
            character_context,
            goal,
            blockage_kind,
            sub_branch,
            blockage_detail,
            upload_intent_id,
            duration_ms,
        ) = row
        turns = list(
            db.scalars(
                select(DbCoachTurn)
                .where(DbCoachTurn.session_id == session_id)
                .order_by(DbCoachTurn.turn_index)
            )
        )
        transcripts = tuple(
            db.scalars(
                select(Transcript.text)
                .where(Transcript.session_id == practice_session_id)
                .order_by(Transcript.ord)
            )
        )
        return _SessionData(
            practice_session_id=practice_session_id,
            session_id=db_session.id,
            summary_id=summary_id,
            user_id=user_id,
            observation_pack=(
                {
                    "observations": observations,
                    "uncertainties": uncertainties,
                }
                if summary_id is not None
                else None
            ),
            situation=situation,
            character_context=character_context,
            goal=goal,
            duration_ms=duration_ms or 0,
            blockage_kind=blockage_kind,
            sub_branch=sub_branch,
            blockage_detail=blockage_detail,
            transcripts=transcripts,
            conversation_summary=db_session.conversation_summary,
            analysis_handoff=(
                PostgresStore._confirmed_analysis_handoff(
                    db,
                    user_id=user_id,
                    upload_intent_id=upload_intent_id,
                )
                if blockage_kind == "표현"
                else None
            ),
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
            practice_session_id=str(data.practice_session_id),
            summary_id=(str(data.summary_id) if data.summary_id is not None else None),
            observation_pack=(
                AgentObservationPack.model_validate(data.observation_pack)
                if data.observation_pack is not None
                else None
            ),
            actor=AgentActorMaterial(
                situation=data.situation,
                character=data.character_context,
                goal=data.goal,
                blockage_kind=data.blockage_kind,
                blockage_detail=data.blockage_detail or "",
                duration_ms=data.duration_ms,
            ),
            blockage_kind=data.blockage_kind,
            sub_branch=data.sub_branch,
            blockage_detail=data.blockage_detail,
            transcripts=list(data.transcripts),
            conversation_summary=data.conversation_summary,
            analysis_handoff=data.analysis_handoff,
            turns=[
                AgentCoachTurn(
                    role=turn.role.value,
                    text=turn.text,
                )
                for turn in data.turns
            ],
            status=data.status,
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

    # ---- 운영 대시보드 조회 ----
    #
    # 이메일·user_id 를 돌려주지 않는다. 누구인지 몰라도 무엇이 오갔는지는 보이고,
    # 토큰이 새더라도 사용자 명단이 되지는 않게 하려는 것이다.

    def admin_stats(self, exclude_emails: tuple[str, ...] = ()) -> dict[str, Any]:
        """운영 지표. `exclude_emails` 에 걸리는 사용자를 뺀 `_real` 값도 같이 낸다.

        team user_id 는 한 번만 구해서 아래 필터 전부가 재사용한다 — 이 엔드포인트는
        15분마다 불리고 카운트가 20개 가까이라, 매번 이메일 조인을 새로 태우면 무거워진다.
        `exclude_emails` 가 비면 `_real` 은 별도 쿼리 없이 포함 값을 그대로 돌려준다.
        """
        now = datetime.now(timezone.utc)
        since_7d = now - timedelta(days=7)
        since_24h = now - timedelta(hours=24)

        with self._session_factory() as db:

            def total(model, *where) -> int:
                stmt = select(func.count()).select_from(model)
                for clause in where:
                    stmt = stmt.where(clause)
                return int(db.execute(stmt).scalar_one())

            def pair(model, exclude_clause, *where) -> tuple[int, int]:
                """(팀 포함, 팀 제외) 카운트 쌍. exclude_clause 가 없으면 값이 같다."""
                all_ = total(model, *where)
                if exclude_clause is None:
                    return all_, all_
                return all_, total(model, exclude_clause, *where)

            def windowed(model, time_col, exclude_clause) -> dict[str, int]:
                """전체·7일·24시간 × (포함, 제외) 여섯 값."""
                t_all, t_real = pair(model, exclude_clause)
                d7_all, d7_real = pair(model, exclude_clause, time_col >= since_7d)
                d24_all, d24_real = pair(model, exclude_clause, time_col >= since_24h)
                return {
                    "total": t_all,
                    "total_real": t_real,
                    "7d": d7_all,
                    "7d_real": d7_real,
                    "24h": d24_all,
                    "24h_real": d24_real,
                }

            def distinct_users(exclude_clause, *where) -> tuple[int, int]:
                stmt = select(func.count(func.distinct(PracticeSession.user_id)))
                for clause in where:
                    stmt = stmt.where(clause)
                all_ = int(db.execute(stmt).scalar_one())
                if exclude_clause is None:
                    return all_, all_
                return all_, int(db.execute(stmt.where(exclude_clause)).scalar_one())

            def returning_counts(excluded_ids: list[UUID]) -> tuple[int, int, int]:
                """연습 세션을 1회/2회/3회 이상 만든 사용자 수."""
                stmt = select(
                    PracticeSession.user_id, func.count().label("n")
                ).group_by(PracticeSession.user_id)
                if excluded_ids:
                    stmt = stmt.where(PracticeSession.user_id.notin_(excluded_ids))
                sub = stmt.subquery()
                with_session = int(
                    db.execute(select(func.count()).select_from(sub)).scalar_one()
                )
                two_plus = int(
                    db.execute(
                        select(func.count()).select_from(sub).where(sub.c.n >= 2)
                    ).scalar_one()
                )
                three_plus = int(
                    db.execute(
                        select(func.count()).select_from(sub).where(sub.c.n >= 3)
                    ).scalar_one()
                )
                return with_session, two_plus, three_plus

            excluded_user_ids: list[UUID] = []
            if exclude_emails:
                excluded_user_ids = list(
                    db.execute(
                        select(User.id).where(
                            func.lower(User.email).in_(
                                [e.lower() for e in exclude_emails]
                            )
                        )
                    ).scalars()
                )

            user_excl = practice_excl = upload_excl = None
            coach_session_excl = coach_turn_excl = report_excl = None
            if excluded_user_ids:
                user_excl = User.id.notin_(excluded_user_ids)
                practice_excl = PracticeSession.user_id.notin_(excluded_user_ids)
                upload_excl = UploadIntent.user_id.notin_(excluded_user_ids)
                # coach_sessions/turns·reports 는 user_id 를 직접 갖지 않는다 —
                # practice_session 을 거쳐야 팀 계정을 골라낼 수 있다.
                excluded_practice_ids = select(PracticeSession.id).where(
                    PracticeSession.user_id.in_(excluded_user_ids)
                )
                coach_session_excl = DbCoachSession.practice_session_id.notin_(
                    excluded_practice_ids
                )
                report_excl = DbPracticeReport.practice_session_id.notin_(
                    excluded_practice_ids
                )
                excluded_coach_session_ids = select(DbCoachSession.id).where(
                    DbCoachSession.practice_session_id.in_(excluded_practice_ids)
                )
                coach_turn_excl = DbCoachTurn.session_id.notin_(
                    excluded_coach_session_ids
                )

            users_w = windowed(User, User.created_at, user_excl)
            sessions_w = windowed(
                PracticeSession, PracticeSession.created_at, practice_excl
            )
            coach_sessions_w = windowed(
                DbCoachSession, DbCoachSession.created_at, coach_session_excl
            )
            coach_turns_w = windowed(
                DbCoachTurn, DbCoachTurn.created_at, coach_turn_excl
            )

            uploads_total, uploads_total_real = pair(
                UploadIntent,
                upload_excl,
                UploadIntent.status == UploadStatus.FINALIZED,
            )
            analyses_total, analyses_total_real = pair(
                PracticeSession,
                practice_excl,
                PracticeSession.status == PracticeStatus.ANALYZED,
            )
            reports_total, reports_total_real = pair(DbPracticeReport, report_excl)

            active_7d, active_7d_real = distinct_users(
                practice_excl, PracticeSession.created_at >= since_7d
            )

            users_with_session, returning_2x, returning_3x = returning_counts([])
            if excluded_user_ids:
                (
                    users_with_session_real,
                    returning_2x_real,
                    returning_3x_real,
                ) = returning_counts(excluded_user_ids)
            else:
                users_with_session_real = users_with_session
                returning_2x_real = returning_2x
                returning_3x_real = returning_3x

            return {
                "users_total": users_w["total"],
                "users_total_real": users_w["total_real"],
                "users_last_7d": users_w["7d"],
                "users_last_7d_real": users_w["7d_real"],
                "users_last_24h": users_w["24h"],
                "users_last_24h_real": users_w["24h_real"],
                "practice_sessions_total": sessions_w["total"],
                "practice_sessions_total_real": sessions_w["total_real"],
                "practice_sessions_last_7d": sessions_w["7d"],
                "practice_sessions_last_7d_real": sessions_w["7d_real"],
                "practice_sessions_last_24h": sessions_w["24h"],
                "practice_sessions_last_24h_real": sessions_w["24h_real"],
                "uploads_finalized_total": uploads_total,
                "uploads_finalized_total_real": uploads_total_real,
                "analyses_completed_total": analyses_total,
                "analyses_completed_total_real": analyses_total_real,
                "coach_sessions_total": coach_sessions_w["total"],
                "coach_sessions_total_real": coach_sessions_w["total_real"],
                "coach_sessions_last_7d": coach_sessions_w["7d"],
                "coach_sessions_last_7d_real": coach_sessions_w["7d_real"],
                "coach_sessions_last_24h": coach_sessions_w["24h"],
                "coach_sessions_last_24h_real": coach_sessions_w["24h_real"],
                "coach_turns_total": coach_turns_w["total"],
                "coach_turns_total_real": coach_turns_w["total_real"],
                "coach_turns_last_7d": coach_turns_w["7d"],
                "coach_turns_last_7d_real": coach_turns_w["7d_real"],
                "coach_turns_last_24h": coach_turns_w["24h"],
                "coach_turns_last_24h_real": coach_turns_w["24h_real"],
                "reports_total": reports_total,
                "reports_total_real": reports_total_real,
                "active_users_last_7d": active_7d,
                "active_users_last_7d_real": active_7d_real,
                "users_with_session": users_with_session,
                "users_with_session_real": users_with_session_real,
                "returning_2x": returning_2x,
                "returning_2x_real": returning_2x_real,
                "returning_3x": returning_3x,
                "returning_3x_real": returning_3x_real,
                "last_signup_at": db.execute(
                    select(func.max(User.created_at))
                ).scalar_one_or_none(),
                "last_session_at": db.execute(
                    select(func.max(PracticeSession.created_at))
                ).scalar_one_or_none(),
            }

    def admin_sessions(
        self, limit: int, exclude_emails: tuple[str, ...] = ()
    ) -> list[dict[str, Any]]:
        """최근 코치 세션. `exclude_emails` 에 해당하는 사용자의 세션은 뺀다.

        팀이 테스트로 만든 세션이 섞이면 실사용자 흐름이 안 보인다. 이메일은
        걸러내는 데만 쓰고 결과에는 넣지 않는다.
        """
        with self._session_factory() as db:
            stmt = (
                select(DbCoachSession, PracticeSession, UploadIntent.object_key)
                .join(
                    PracticeSession,
                    PracticeSession.id == DbCoachSession.practice_session_id,
                    isouter=True,
                )
                .join(
                    UploadIntent,
                    and_(
                        UploadIntent.id == PracticeSession.upload_intent_id,
                        UploadIntent.status == UploadStatus.FINALIZED,
                    ),
                    isouter=True,
                )
                .order_by(DbCoachSession.created_at.desc())
            )
            if exclude_emails:
                # 제외 대상은 users 를 거쳐야 알 수 있다. 조인은 필터 전용이고
                # 이메일은 결과에 담기지 않는다.
                stmt = stmt.join(
                    User, User.id == PracticeSession.user_id, isouter=True
                ).where(
                    or_(
                        User.email.is_(None),
                        func.lower(User.email).notin_(
                            [e.lower() for e in exclude_emails]
                        ),
                    )
                )
            rows = db.execute(stmt.limit(limit)).all()

            sessions: list[dict[str, Any]] = []
            for coach, practice, object_key in rows:
                turns = db.execute(
                    select(DbCoachTurn)
                    .where(DbCoachTurn.session_id == coach.id)
                    .order_by(DbCoachTurn.turn_index)
                ).scalars().all()
                sessions.append(
                    {
                        "coach_session_id": str(coach.id),
                        "created_at": coach.created_at,
                        "status": getattr(coach.status, "value", coach.status),
                        "close_reason": getattr(
                            coach.close_reason, "value", coach.close_reason
                        ),
                        "situation": practice.situation if practice else None,
                        "character_context": (
                            practice.character_context if practice else None
                        ),
                        "goal": practice.goal if practice else None,
                        "turns": [
                            {
                                "turn_index": t.turn_index,
                                "role": getattr(t.role, "value", t.role),
                                "text": t.text or "",
                            }
                            for t in turns
                        ],
                        "object_key": object_key,
                    }
                )
            return sessions
