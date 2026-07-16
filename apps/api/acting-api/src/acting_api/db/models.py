import enum
import uuid
from datetime import datetime
from typing import Any

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


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


def _enum_values(enum_type: type[enum.Enum]) -> list[str]:
    return [member.value for member in enum_type]


intent_impact_enum = sa.Enum(
    IntentImpact,
    name="intent_impact_t",
    values_callable=_enum_values,
)
severity_enum = sa.Enum(
    Severity,
    name="severity_t",
    values_callable=_enum_values,
)
session_status_enum = sa.Enum(
    SessionStatus,
    name="session_status_t",
    values_callable=_enum_values,
)
close_reason_enum = sa.Enum(
    CloseReason,
    name="close_reason_t",
    values_callable=_enum_values,
)
turn_role_enum = sa.Enum(
    TurnRole,
    name="turn_role_t",
    values_callable=_enum_values,
)


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
    external_id: Mapped[str] = mapped_column(sa.Text, nullable=False, unique=True)
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
    )


class ApiKey(Base):
    __tablename__ = "api_keys"

    id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=sa.text("gen_random_uuid()"),
    )
    key_hash: Mapped[str] = mapped_column(sa.Text, nullable=False, unique=True)
    label: Mapped[str] = mapped_column(sa.Text, nullable=False)
    rate_limit_per_min: Mapped[int] = mapped_column(
        sa.Integer, nullable=False, default=10, server_default=sa.text("10")
    )
    is_active: Mapped[bool] = mapped_column(
        sa.Boolean, nullable=False, default=True, server_default=sa.true()
    )
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
    )
    revoked_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))


class Scene(Base):
    __tablename__ = "scenes"

    id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=sa.text("gen_random_uuid()"),
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        sa.ForeignKey("users.id"),
        nullable=False,
    )
    situation: Mapped[str] = mapped_column(sa.Text, nullable=False)
    character: Mapped[str] = mapped_column(sa.Text, nullable=False)
    subtext: Mapped[str] = mapped_column(sa.Text, nullable=False)
    video_filename: Mapped[str | None] = mapped_column(sa.Text)
    video_size_bytes: Mapped[int | None] = mapped_column(sa.BigInteger)
    was_compressed: Mapped[bool] = mapped_column(
        sa.Boolean, nullable=False, default=False, server_default=sa.false()
    )
    model: Mapped[str] = mapped_column(sa.Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
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
    scene_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        sa.ForeignKey("scenes.id", ondelete="CASCADE"),
        nullable=False,
    )
    observation: Mapped[dict[str, Any]] = mapped_column(
        postgresql.JSONB, nullable=False
    )
    summary: Mapped[str] = mapped_column(sa.Text, nullable=False)
    intent_alignment: Mapped[str] = mapped_column(sa.Text, nullable=False)
    key_moment: Mapped[str] = mapped_column(sa.Text, nullable=False)
    key_dimension: Mapped[str] = mapped_column(sa.Text, nullable=False)
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
        postgresql.UUID(as_uuid=True),
        sa.ForeignKey("summaries.id"),
        nullable=False,
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
    __table_args__ = (sa.UniqueConstraint("session_id", "turn_index"),)

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


sa.Index("idx_turns_session", CoachTurn.session_id, CoachTurn.turn_index)
sa.Index("idx_anomalies_summary", Anomaly.summary_id, Anomaly.sort_order)
sa.Index("idx_scenes_user", Scene.user_id, Scene.created_at.desc())
sa.Index("idx_summaries_scene", Summary.scene_id)
sa.Index("idx_sessions_summary", CoachSession.summary_id)
