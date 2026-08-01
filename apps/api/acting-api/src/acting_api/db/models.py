import enum
import uuid
from datetime import datetime
from typing import Any

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class UserStatus(str, enum.Enum):
    ACTIVE = "active"
    SUSPENDED = "suspended"


class IdentityProvider(str, enum.Enum):
    GOOGLE = "google"
    KAKAO = "kakao"
    APPLE = "apple"
    DEVELOPMENT = "development"


class ConsentType(str, enum.Enum):
    TERMS = "terms"
    PRIVACY = "privacy"
    AI_ANALYSIS = "ai_analysis"


class ConsentAction(str, enum.Enum):
    GRANTED = "granted"
    DECLINED = "declined"
    REVOKED = "revoked"


class UploadStatus(str, enum.Enum):
    PENDING = "pending"
    FINALIZED = "finalized"
    EXPIRED = "expired"


class PracticeStatus(str, enum.Enum):
    CREATED = "created"
    ANALYZING = "analyzing"
    ANALYZED = "analyzed"
    FAILED = "failed"


class IntentImpact(str, enum.Enum):
    REVERSAL = "반전"
    WEAKENING = "약화"
    LOCAL = "국소"


class Severity(str, enum.Enum):
    HIGH = "high"
    MID = "mid"
    LOW = "low"


class SessionStatus(str, enum.Enum):
    OPEN = "open"
    CLOSED = "closed"


class CloseReason(str, enum.Enum):
    GAP_STATED = "gap_stated"
    EXHAUSTED = "exhausted"
    LIMIT = "limit"
    USER_ENDED = "user_ended"


class TurnRole(str, enum.Enum):
    AI = "ai"
    ACTOR = "actor"


class OperationKind(str, enum.Enum):
    ANALYZE = "analyze"
    COACH_START = "coach_start"
    COACH_REPLY = "coach_reply"
    REPORT = "report"


class OperationStatus(str, enum.Enum):
    PENDING = "pending"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"


class ContentStatus(str, enum.Enum):
    """글·댓글의 노출 상태. 삭제해도 행은 남긴다 — 신고 처리에 원문이 필요하다."""

    VISIBLE = "visible"
    # 운영자가 내린 상태. 작성자에게는 보이되 목록에서는 빠진다.
    HIDDEN = "hidden"
    DELETED = "deleted"


class ReportTargetType(str, enum.Enum):
    POST = "post"
    COMMENT = "comment"


class ReportReason(str, enum.Enum):
    SPAM = "spam"
    ABUSE = "abuse"
    SEXUAL = "sexual"
    PRIVACY = "privacy"
    OTHER = "other"


class ReportStatus(str, enum.Enum):
    PENDING = "pending"
    ACTIONED = "actioned"
    DISMISSED = "dismissed"


def _enum_values(enum_type: type[enum.Enum]) -> list[str]:
    return [member.value for member in enum_type]


def _enum(enum_type: type[enum.Enum], name: str) -> sa.Enum:
    return sa.Enum(enum_type, name=name, values_callable=_enum_values)


user_status_enum = _enum(UserStatus, "user_status_t")
identity_provider_enum = _enum(IdentityProvider, "identity_provider_t")
consent_type_enum = _enum(ConsentType, "consent_type_t")
consent_action_enum = _enum(ConsentAction, "consent_action_t")
upload_status_enum = _enum(UploadStatus, "upload_status_t")
practice_status_enum = _enum(PracticeStatus, "practice_status_t")
intent_impact_enum = _enum(IntentImpact, "intent_impact_t")
severity_enum = _enum(Severity, "severity_t")
session_status_enum = _enum(SessionStatus, "session_status_t")
close_reason_enum = _enum(CloseReason, "close_reason_t")
turn_role_enum = _enum(TurnRole, "turn_role_t")
operation_kind_enum = _enum(OperationKind, "operation_kind_t")
operation_status_enum = _enum(OperationStatus, "operation_status_t")
content_status_enum = _enum(ContentStatus, "content_status_t")
report_target_type_enum = _enum(ReportTargetType, "report_target_type_t")
report_reason_enum = _enum(ReportReason, "report_reason_t")
report_status_enum = _enum(ReportStatus, "report_status_t")


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=sa.text("gen_random_uuid()"),
    )
    email: Mapped[str | None] = mapped_column(sa.Text, unique=True)
    # 화면에 보이는 이름. 커뮤니티 작성자 표시와 연습 화면 호칭에 같이 쓴다.
    # 일부러 UNIQUE 를 걸지 않았다 — 가입 첫 화면에서 "이미 쓰는 이름" 을 만나면
    # 이탈이 생긴다. 동일인 판별은 user_id 로 하고, 사칭은 신고로 처리한다.
    nickname: Mapped[str | None] = mapped_column(sa.Text)
    status: Mapped[UserStatus] = mapped_column(
        user_status_enum,
        nullable=False,
        default=UserStatus.ACTIVE,
        server_default=sa.text("'active'"),
    )
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
    )


class UserIdentity(Base):
    __tablename__ = "user_identities"
    __table_args__ = (
        sa.UniqueConstraint(
            "provider", "provider_uid", name="uq_user_identities_provider_uid"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=sa.text("gen_random_uuid()"),
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False
    )
    provider: Mapped[IdentityProvider] = mapped_column(
        identity_provider_enum, nullable=False
    )
    provider_uid: Mapped[str] = mapped_column(sa.Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
    )


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=sa.text("gen_random_uuid()"),
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False
    )
    replaced_by_id: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True), sa.ForeignKey("refresh_tokens.id")
    )
    token_hash: Mapped[str] = mapped_column(sa.CHAR(64), nullable=False, unique=True)
    device_info: Mapped[str | None] = mapped_column(sa.Text)
    issued_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
    )
    expires_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False
    )
    revoked_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))


class ConsentDocument(Base):
    __tablename__ = "consent_documents"
    __table_args__ = (
        sa.UniqueConstraint(
            "type", "version", name="uq_consent_documents_type_version"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=sa.text("gen_random_uuid()"),
    )
    type: Mapped[ConsentType] = mapped_column(consent_type_enum, nullable=False)
    version: Mapped[str] = mapped_column(sa.Text, nullable=False)
    title: Mapped[str] = mapped_column(sa.Text, nullable=False)
    body: Mapped[str] = mapped_column(sa.Text, nullable=False)
    required: Mapped[bool] = mapped_column(
        sa.Boolean, nullable=False, default=False, server_default=sa.false()
    )
    published_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
    )


class UserConsent(Base):
    __tablename__ = "user_consents"

    id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=sa.text("gen_random_uuid()"),
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False
    )
    document_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        sa.ForeignKey("consent_documents.id"),
        nullable=False,
    )
    action: Mapped[ConsentAction] = mapped_column(consent_action_enum, nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
    )


class UploadIntent(Base):
    __tablename__ = "upload_intents"

    id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=sa.text("gen_random_uuid()"),
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False
    )
    status: Mapped[UploadStatus] = mapped_column(
        upload_status_enum,
        nullable=False,
        default=UploadStatus.PENDING,
        server_default=sa.text("'pending'"),
    )
    storage_provider: Mapped[str] = mapped_column(sa.Text, nullable=False)
    object_key: Mapped[str] = mapped_column(sa.Text, nullable=False, unique=True)
    mime_type: Mapped[str] = mapped_column(sa.Text, nullable=False)
    size_bytes: Mapped[int] = mapped_column(sa.BigInteger, nullable=False)
    duration_ms: Mapped[int | None] = mapped_column(sa.Integer)
    etag: Mapped[str | None] = mapped_column(sa.Text)
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
    )
    expires_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False
    )
    finalized_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))


class PracticeSession(Base):
    __tablename__ = "practice_sessions"

    id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=sa.text("gen_random_uuid()"),
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False
    )
    upload_intent_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        sa.ForeignKey("upload_intents.id"),
        nullable=False,
        unique=True,
    )
    status: Mapped[PracticeStatus] = mapped_column(
        practice_status_enum,
        nullable=False,
        default=PracticeStatus.CREATED,
        server_default=sa.text("'created'"),
    )
    situation: Mapped[str] = mapped_column(sa.Text, nullable=False)
    character_context: Mapped[str] = mapped_column(sa.Text, nullable=False)
    subtext: Mapped[str] = mapped_column(sa.Text, nullable=False)
    hidden_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
    )


class Summary(Base):
    __tablename__ = "summaries"

    id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=sa.text("gen_random_uuid()"),
    )
    session_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        sa.ForeignKey("practice_sessions.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )
    observation: Mapped[dict[str, Any]] = mapped_column(
        postgresql.JSONB, nullable=False
    )
    summary: Mapped[str] = mapped_column(sa.Text, nullable=False)
    intent_alignment: Mapped[str] = mapped_column(sa.Text, nullable=False)
    key_moment: Mapped[str] = mapped_column(sa.Text, nullable=False)
    key_dimension: Mapped[str] = mapped_column(sa.Text, nullable=False)
    model: Mapped[str] = mapped_column(sa.Text, nullable=False)
    was_compressed: Mapped[bool] = mapped_column(
        sa.Boolean, nullable=False, default=False, server_default=sa.false()
    )
    raw: Mapped[dict[str, Any]] = mapped_column(postgresql.JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
    )


class Anomaly(Base):
    __tablename__ = "anomalies"

    id: Mapped[int] = mapped_column(sa.BigInteger, primary_key=True, autoincrement=True)
    summary_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        sa.ForeignKey("summaries.id", ondelete="CASCADE"),
        nullable=False,
    )
    sort_order: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    start_ts: Mapped[str] = mapped_column(sa.Text, nullable=False)
    end_ts: Mapped[str] = mapped_column(sa.Text, nullable=False)
    dimension: Mapped[str] = mapped_column(sa.Text, nullable=False)
    what: Mapped[str] = mapped_column(sa.Text, nullable=False)
    why_odd: Mapped[str] = mapped_column(sa.Text, nullable=False)
    likely_cause: Mapped[str] = mapped_column(sa.Text, nullable=False)
    impact_on_intent: Mapped[str] = mapped_column(sa.Text, nullable=False)
    overlaps_key_moment: Mapped[bool] = mapped_column(
        sa.Boolean, nullable=False, default=False, server_default=sa.false()
    )
    on_key_dimension: Mapped[bool] = mapped_column(
        sa.Boolean, nullable=False, default=False, server_default=sa.false()
    )
    intent_impact: Mapped[IntentImpact] = mapped_column(
        intent_impact_enum, nullable=False
    )
    severity: Mapped[Severity] = mapped_column(severity_enum, nullable=False)
    severity_reason: Mapped[str] = mapped_column(sa.Text, nullable=False)


class CoachSession(Base):
    __tablename__ = "coach_sessions"

    id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True), primary_key=True
    )
    summary_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True), sa.ForeignKey("summaries.id"), nullable=False
    )
    status: Mapped[SessionStatus] = mapped_column(
        session_status_enum,
        nullable=False,
        default=SessionStatus.OPEN,
        server_default=sa.text("'open'"),
    )
    close_reason: Mapped[CloseReason | None] = mapped_column(close_reason_enum)
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
    )


class CoachTurn(Base):
    __tablename__ = "coach_turns"
    __table_args__ = (
        sa.UniqueConstraint(
            "session_id", "turn_index", name="uq_coach_turns_session_index"
        ),
    )

    id: Mapped[int] = mapped_column(sa.BigInteger, primary_key=True, autoincrement=True)
    session_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        sa.ForeignKey("coach_sessions.id", ondelete="CASCADE"),
        nullable=False,
    )
    turn_index: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    role: Mapped[TurnRole] = mapped_column(turn_role_enum, nullable=False)
    text: Mapped[str] = mapped_column(sa.Text, nullable=False)
    action: Mapped[str | None] = mapped_column(sa.Text)
    focus_timestamp: Mapped[str] = mapped_column(
        sa.Text, nullable=False, default="", server_default=sa.text("''")
    )
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
    )


class Report(Base):
    __tablename__ = "reports"

    id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=sa.text("gen_random_uuid()"),
    )
    session_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        sa.ForeignKey("coach_sessions.id"),
        nullable=False,
        unique=True,
    )
    headline: Mapped[str] = mapped_column(sa.Text, nullable=False)
    biggest_problem: Mapped[dict[str, Any]] = mapped_column(
        postgresql.JSONB, nullable=False
    )
    evidence: Mapped[str] = mapped_column(sa.Text, nullable=False)
    self_discovery: Mapped[str] = mapped_column(sa.Text, nullable=False)
    encouragement: Mapped[str] = mapped_column(sa.Text, nullable=False)
    next_step: Mapped[str] = mapped_column(sa.Text, nullable=False)
    comparison: Mapped[str] = mapped_column(
        sa.Text, nullable=False, default="", server_default=sa.text("''")
    )
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
    )


class ExternalOperation(Base):
    __tablename__ = "external_operations"
    __table_args__ = (
        sa.UniqueConstraint(
            "user_id", "request_id", name="uq_external_operations_user_request"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=sa.text("gen_random_uuid()"),
    )
    session_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        sa.ForeignKey("practice_sessions.id"),
        nullable=False,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False
    )
    request_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True), nullable=False
    )
    kind: Mapped[OperationKind] = mapped_column(operation_kind_enum, nullable=False)
    status: Mapped[OperationStatus] = mapped_column(
        operation_status_enum,
        nullable=False,
        default=OperationStatus.PENDING,
        server_default=sa.text("'pending'"),
    )
    attempt_count: Mapped[int] = mapped_column(
        sa.Integer, nullable=False, default=0, server_default=sa.text("0")
    )
    request_fingerprint: Mapped[str] = mapped_column(sa.CHAR(64), nullable=False)
    lease_token: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True)
    )
    lease_expires_at: Mapped[datetime | None] = mapped_column(
        sa.DateTime(timezone=True)
    )
    error_code: Mapped[str | None] = mapped_column(sa.Text)
    response_payload: Mapped[dict[str, Any] | None] = mapped_column(postgresql.JSONB)
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
    )


class CommunityCategory(Base):
    """게시판 구분. 코드 상수가 아니라 행으로 둔다 — 배포 없이 추가·정렬할 수 있다."""

    __tablename__ = "community_categories"

    id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=sa.text("gen_random_uuid()"),
    )
    slug: Mapped[str] = mapped_column(sa.Text, nullable=False, unique=True)
    name: Mapped[str] = mapped_column(sa.Text, nullable=False)
    description: Mapped[str | None] = mapped_column(sa.Text)
    sort_order: Mapped[int] = mapped_column(
        sa.Integer, nullable=False, default=0, server_default=sa.text("0")
    )
    is_active: Mapped[bool] = mapped_column(
        sa.Boolean, nullable=False, default=True, server_default=sa.text("true")
    )
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
    )


class CommunityPost(Base):
    __tablename__ = "community_posts"

    id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=sa.text("gen_random_uuid()"),
    )
    category_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        sa.ForeignKey("community_categories.id"),
        nullable=False,
    )
    author_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False
    )
    title: Mapped[str] = mapped_column(sa.Text, nullable=False)
    body: Mapped[str] = mapped_column(sa.Text, nullable=False)
    # 올린 뒤에는 바꾸지 않는다. 실명↔익명을 뒤집으면 이미 읽힌 글의 신원이
    # 소급해서 드러나거나, 달려 있던 익명 번호가 갈 곳을 잃는다.
    anonymous: Mapped[bool] = mapped_column(
        sa.Boolean, nullable=False, default=False, server_default=sa.text("false")
    )
    status: Mapped[ContentStatus] = mapped_column(
        content_status_enum,
        nullable=False,
        default=ContentStatus.VISIBLE,
        server_default=sa.text("'visible'"),
    )
    # 목록에서 글마다 COUNT 를 돌리지 않으려고 비정규화한다. 증감은 같은 트랜잭션에서.
    like_count: Mapped[int] = mapped_column(
        sa.Integer, nullable=False, default=0, server_default=sa.text("0")
    )
    comment_count: Mapped[int] = mapped_column(
        sa.Integer, nullable=False, default=0, server_default=sa.text("0")
    )
    view_count: Mapped[int] = mapped_column(
        sa.Integer, nullable=False, default=0, server_default=sa.text("0")
    )
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
    )


class CommunityComment(Base):
    """1단계 댓글만. 대댓글은 parent_id 를 뒤에 붙이는 마이그레이션으로 연다."""

    __tablename__ = "community_comments"

    id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=sa.text("gen_random_uuid()"),
    )
    post_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        sa.ForeignKey("community_posts.id"),
        nullable=False,
    )
    author_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False
    )
    body: Mapped[str] = mapped_column(sa.Text, nullable=False)
    anonymous: Mapped[bool] = mapped_column(
        sa.Boolean, nullable=False, default=False, server_default=sa.text("false")
    )
    status: Mapped[ContentStatus] = mapped_column(
        content_status_enum,
        nullable=False,
        default=ContentStatus.VISIBLE,
        server_default=sa.text("'visible'"),
    )
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
    )


class CommunityAnonymousAlias(Base):
    """글 하나 안에서 익명 작성자에게 붙는 번호(익명1·익명2).

    계산하지 않고 저장하는 이유: 댓글이 커서로 나뉘어 오면 뒷장만 받은 서버는 앞에
    익명이 몇 명이었는지 알 수 없어 같은 사람이 페이지마다 다른 번호를 받는다.

    `post_id` 범위 안에서만 유효하다 — 다른 글의 익명1 과 아무 관계가 없어야 익명이
    성립한다.
    """

    __tablename__ = "community_anonymous_aliases"
    __table_args__ = (
        sa.UniqueConstraint("post_id", "user_id", name="uq_community_alias_post_user"),
        sa.UniqueConstraint(
            "post_id", "ordinal", name="uq_community_alias_post_ordinal"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=sa.text("gen_random_uuid()"),
    )
    post_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        sa.ForeignKey("community_posts.id"),
        nullable=False,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False
    )
    ordinal: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
    )


class CommunityPostLike(Base):
    __tablename__ = "community_post_likes"
    __table_args__ = (
        sa.UniqueConstraint("post_id", "user_id", name="uq_community_post_likes"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=sa.text("gen_random_uuid()"),
    )
    post_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        sa.ForeignKey("community_posts.id"),
        nullable=False,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
    )


class CommunityReport(Base):
    """신고. target_id 에는 FK 를 걸지 않는다 — 글과 댓글 두 테이블을 함께 가리킨다."""

    __tablename__ = "community_reports"
    __table_args__ = (
        sa.UniqueConstraint(
            "reporter_id",
            "target_type",
            "target_id",
            name="uq_community_reports_reporter_target",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=sa.text("gen_random_uuid()"),
    )
    reporter_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False
    )
    target_type: Mapped[ReportTargetType] = mapped_column(
        report_target_type_enum, nullable=False
    )
    target_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True), nullable=False
    )
    reason: Mapped[ReportReason] = mapped_column(report_reason_enum, nullable=False)
    detail: Mapped[str | None] = mapped_column(sa.Text)
    status: Mapped[ReportStatus] = mapped_column(
        report_status_enum,
        nullable=False,
        default=ReportStatus.PENDING,
        server_default=sa.text("'pending'"),
    )
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
    )


class CommunityBlock(Base):
    """차단. 차단한 사람 눈에서만 상대 글이 사라진다(상대는 아무것도 모른다)."""

    __tablename__ = "community_blocks"
    __table_args__ = (
        sa.UniqueConstraint(
            "blocker_id", "blocked_id", name="uq_community_blocks_pair"
        ),
        sa.CheckConstraint(
            "blocker_id <> blocked_id", name="ck_community_blocks_not_self"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=sa.text("gen_random_uuid()"),
    )
    blocker_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False
    )
    blocked_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
    )


sa.Index("idx_user_identities_user", UserIdentity.user_id)
sa.Index("idx_refresh_tokens_user_expires", RefreshToken.user_id, RefreshToken.expires_at)
sa.Index(
    "idx_consent_documents_latest",
    ConsentDocument.type,
    ConsentDocument.published_at.desc(),
)
sa.Index(
    "idx_user_consents_current",
    UserConsent.user_id,
    UserConsent.document_id,
    UserConsent.occurred_at.desc(),
)
sa.Index("idx_upload_intents_user_created", UploadIntent.user_id, UploadIntent.created_at.desc())
sa.Index("idx_upload_intents_expiry", UploadIntent.status, UploadIntent.expires_at)
sa.Index(
    "idx_practice_sessions_user_visible_created",
    PracticeSession.user_id,
    PracticeSession.created_at.desc(),
    postgresql_where=PracticeSession.hidden_at.is_(None),
)
sa.Index("idx_practice_sessions_user", PracticeSession.user_id)
sa.Index(
    "idx_practice_sessions_status_updated",
    PracticeSession.status,
    PracticeSession.updated_at,
)
sa.Index("idx_anomalies_summary", Anomaly.summary_id, Anomaly.sort_order)
sa.Index("idx_sessions_summary", CoachSession.summary_id)
sa.Index("idx_turns_session", CoachTurn.session_id, CoachTurn.turn_index)
sa.Index("idx_reports_created", Report.created_at.desc())
sa.Index(
    "idx_external_operations_claimable",
    ExternalOperation.kind,
    ExternalOperation.status,
    ExternalOperation.created_at,
)
sa.Index("idx_external_operations_session", ExternalOperation.session_id)
sa.Index(
    "idx_external_operations_status_attempt_lease",
    ExternalOperation.status,
    ExternalOperation.attempt_count,
    ExternalOperation.lease_expires_at,
)
# 목록 질의 그대로의 순서 — 카테고리로 좁히고 최신순으로 커서를 민다.
sa.Index(
    "idx_community_posts_category_created",
    CommunityPost.category_id,
    CommunityPost.created_at.desc(),
    CommunityPost.id.desc(),
    postgresql_where=CommunityPost.status == ContentStatus.VISIBLE,
)
sa.Index(
    "idx_community_posts_created",
    CommunityPost.created_at.desc(),
    CommunityPost.id.desc(),
    postgresql_where=CommunityPost.status == ContentStatus.VISIBLE,
)
sa.Index("idx_community_posts_author", CommunityPost.author_id)
sa.Index(
    "idx_community_comments_post_created",
    CommunityComment.post_id,
    CommunityComment.created_at,
    CommunityComment.id,
)
sa.Index("idx_community_comments_author", CommunityComment.author_id)
sa.Index("idx_community_post_likes_user", CommunityPostLike.user_id)
sa.Index(
    "idx_community_reports_status_created",
    CommunityReport.status,
    CommunityReport.created_at.desc(),
)
sa.Index("idx_community_blocks_blocker", CommunityBlock.blocker_id)
sa.Index(
    "idx_community_alias_post",
    CommunityAnonymousAlias.post_id,
    CommunityAnonymousAlias.ordinal,
)
