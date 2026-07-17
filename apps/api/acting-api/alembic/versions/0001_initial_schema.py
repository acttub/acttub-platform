"""Create the platform v2 PostgreSQL schema.

Revision ID: 0001_initial_schema
Revises:
Create Date: 2026-07-17
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0001_initial_schema"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _pg_enum(name: str, *values: str) -> postgresql.ENUM:
    return postgresql.ENUM(*values, name=name, create_type=False)


user_status_t = _pg_enum("user_status_t", "active", "suspended")
identity_provider_t = _pg_enum(
    "identity_provider_t", "google", "kakao", "apple"
)
consent_type_t = _pg_enum(
    "consent_type_t", "terms", "privacy", "ai_analysis"
)
consent_action_t = _pg_enum(
    "consent_action_t", "granted", "declined", "revoked"
)
upload_status_t = _pg_enum("upload_status_t", "pending", "finalized", "expired")
practice_status_t = _pg_enum(
    "practice_status_t", "created", "analyzing", "analyzed", "failed"
)
intent_impact_t = _pg_enum("intent_impact_t", "반전", "약화", "국소")
severity_t = _pg_enum("severity_t", "high", "mid", "low")
session_status_t = _pg_enum("session_status_t", "open", "closed")
close_reason_t = _pg_enum(
    "close_reason_t", "gap_stated", "exhausted", "limit", "user_ended"
)
turn_role_t = _pg_enum("turn_role_t", "ai", "actor")
operation_kind_t = _pg_enum(
    "operation_kind_t", "analyze", "coach_start", "coach_reply", "report"
)
operation_status_t = _pg_enum(
    "operation_status_t", "pending", "running", "succeeded", "failed"
)

ENUMS = (
    user_status_t,
    identity_provider_t,
    consent_type_t,
    consent_action_t,
    upload_status_t,
    practice_status_t,
    intent_impact_t,
    severity_t,
    session_status_t,
    close_reason_t,
    turn_role_t,
    operation_kind_t,
    operation_status_t,
)


def _uuid(name: str, *, nullable: bool = False) -> sa.Column:
    return sa.Column(name, postgresql.UUID(as_uuid=True), nullable=nullable)


def _generated_uuid(name: str = "id") -> sa.Column:
    return sa.Column(
        name,
        postgresql.UUID(as_uuid=True),
        server_default=sa.text("gen_random_uuid()"),
        nullable=False,
    )


def _timestamp(
    name: str, *, nullable: bool = False, server_default: sa.TextClause | None = None
) -> sa.Column:
    return sa.Column(
        name,
        sa.DateTime(timezone=True),
        nullable=nullable,
        server_default=server_default,
    )


def upgrade() -> None:
    bind = op.get_bind()
    for enum_type in ENUMS:
        enum_type.create(bind, checkfirst=False)

    op.create_table(
        "users",
        _generated_uuid(),
        sa.Column("email", sa.Text(), nullable=True),
        sa.Column(
            "status",
            user_status_t,
            server_default=sa.text("'active'"),
            nullable=False,
        ),
        _timestamp("created_at", server_default=sa.text("now()")),
        _timestamp("updated_at", server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("email"),
    )
    op.create_table(
        "consent_documents",
        _generated_uuid(),
        sa.Column("type", consent_type_t, nullable=False),
        sa.Column("version", sa.Text(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column(
            "required",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        _timestamp("published_at", server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "type", "version", name="uq_consent_documents_type_version"
        ),
    )
    op.create_table(
        "user_identities",
        _generated_uuid(),
        _uuid("user_id"),
        sa.Column("provider", identity_provider_t, nullable=False),
        sa.Column("provider_uid", sa.Text(), nullable=False),
        _timestamp("created_at", server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "provider", "provider_uid", name="uq_user_identities_provider_uid"
        ),
    )
    op.create_table(
        "refresh_tokens",
        _generated_uuid(),
        _uuid("user_id"),
        _uuid("replaced_by_id", nullable=True),
        sa.Column("token_hash", sa.CHAR(length=64), nullable=False),
        sa.Column("device_info", sa.Text(), nullable=True),
        _timestamp("issued_at", server_default=sa.text("now()")),
        _timestamp("expires_at"),
        _timestamp("revoked_at", nullable=True),
        sa.ForeignKeyConstraint(["replaced_by_id"], ["refresh_tokens.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash"),
    )
    op.create_table(
        "user_consents",
        _generated_uuid(),
        _uuid("user_id"),
        _uuid("document_id"),
        sa.Column("action", consent_action_t, nullable=False),
        _timestamp("occurred_at", server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["document_id"], ["consent_documents.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "upload_intents",
        _generated_uuid(),
        _uuid("user_id"),
        sa.Column(
            "status",
            upload_status_t,
            server_default=sa.text("'pending'"),
            nullable=False,
        ),
        sa.Column("storage_provider", sa.Text(), nullable=False),
        sa.Column("object_key", sa.Text(), nullable=False),
        sa.Column("mime_type", sa.Text(), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("etag", sa.Text(), nullable=True),
        _timestamp("created_at", server_default=sa.text("now()")),
        _timestamp("expires_at"),
        _timestamp("finalized_at", nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("object_key"),
    )
    op.create_table(
        "practice_sessions",
        _generated_uuid(),
        _uuid("user_id"),
        _uuid("upload_intent_id"),
        sa.Column(
            "status",
            practice_status_t,
            server_default=sa.text("'created'"),
            nullable=False,
        ),
        sa.Column("situation", sa.Text(), nullable=False),
        sa.Column("character_context", sa.Text(), nullable=False),
        sa.Column("subtext", sa.Text(), nullable=False),
        _timestamp("hidden_at", nullable=True),
        _timestamp("created_at", server_default=sa.text("now()")),
        _timestamp("updated_at", server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["upload_intent_id"], ["upload_intents.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("upload_intent_id"),
    )
    op.create_table(
        "summaries",
        _generated_uuid(),
        _uuid("session_id"),
        sa.Column(
            "observation", postgresql.JSONB(astext_type=sa.Text()), nullable=False
        ),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("intent_alignment", sa.Text(), nullable=False),
        sa.Column("key_moment", sa.Text(), nullable=False),
        sa.Column("key_dimension", sa.Text(), nullable=False),
        sa.Column("model", sa.Text(), nullable=False),
        sa.Column(
            "was_compressed",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.Column("raw", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        _timestamp("created_at", server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(
            ["session_id"], ["practice_sessions.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "anomalies",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        _uuid("summary_id"),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("start_ts", sa.Text(), nullable=False),
        sa.Column("end_ts", sa.Text(), nullable=False),
        sa.Column("dimension", sa.Text(), nullable=False),
        sa.Column("what", sa.Text(), nullable=False),
        sa.Column("why_odd", sa.Text(), nullable=False),
        sa.Column("likely_cause", sa.Text(), nullable=False),
        sa.Column("impact_on_intent", sa.Text(), nullable=False),
        sa.Column(
            "overlaps_key_moment",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.Column(
            "on_key_dimension",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.Column("intent_impact", intent_impact_t, nullable=False),
        sa.Column("severity", severity_t, nullable=False),
        sa.Column("severity_reason", sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(
            ["summary_id"], ["summaries.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "coach_sessions",
        _uuid("id"),
        _uuid("summary_id"),
        sa.Column(
            "status",
            session_status_t,
            server_default=sa.text("'open'"),
            nullable=False,
        ),
        sa.Column("close_reason", close_reason_t, nullable=True),
        _timestamp("created_at", server_default=sa.text("now()")),
        _timestamp("updated_at", server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["summary_id"], ["summaries.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "coach_turns",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        _uuid("session_id"),
        sa.Column("turn_index", sa.Integer(), nullable=False),
        sa.Column("role", turn_role_t, nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("action", sa.Text(), nullable=True),
        sa.Column(
            "focus_timestamp",
            sa.Text(),
            server_default=sa.text("''"),
            nullable=False,
        ),
        _timestamp("created_at", server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(
            ["session_id"], ["coach_sessions.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "session_id", "turn_index", name="uq_coach_turns_session_index"
        ),
    )
    op.create_table(
        "reports",
        _generated_uuid(),
        _uuid("session_id"),
        sa.Column("headline", sa.Text(), nullable=False),
        sa.Column(
            "biggest_problem", postgresql.JSONB(astext_type=sa.Text()), nullable=False
        ),
        sa.Column("evidence", sa.Text(), nullable=False),
        sa.Column("self_discovery", sa.Text(), nullable=False),
        sa.Column("encouragement", sa.Text(), nullable=False),
        sa.Column("next_step", sa.Text(), nullable=False),
        sa.Column(
            "comparison",
            sa.Text(),
            server_default=sa.text("''"),
            nullable=False,
        ),
        _timestamp("created_at", server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["session_id"], ["coach_sessions.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("session_id", name="reports_session_id_key"),
    )
    op.create_table(
        "external_operations",
        _generated_uuid(),
        _uuid("session_id"),
        _uuid("user_id"),
        _uuid("request_id"),
        sa.Column("kind", operation_kind_t, nullable=False),
        sa.Column(
            "status",
            operation_status_t,
            server_default=sa.text("'pending'"),
            nullable=False,
        ),
        sa.Column(
            "attempt_count",
            sa.Integer(),
            server_default=sa.text("0"),
            nullable=False,
        ),
        sa.Column("request_fingerprint", sa.CHAR(length=64), nullable=False),
        _uuid("lease_token", nullable=True),
        _timestamp("lease_expires_at", nullable=True),
        sa.Column("error_code", sa.Text(), nullable=True),
        sa.Column(
            "response_payload",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
        _timestamp("created_at", server_default=sa.text("now()")),
        _timestamp("updated_at", server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["session_id"], ["practice_sessions.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "user_id", "request_id", name="uq_external_operations_user_request"
        ),
    )

    op.create_index("idx_user_identities_user", "user_identities", ["user_id"])
    op.create_index(
        "idx_refresh_tokens_user_expires",
        "refresh_tokens",
        ["user_id", "expires_at"],
    )
    op.create_index(
        "idx_consent_documents_latest",
        "consent_documents",
        ["type", sa.literal_column("published_at").desc()],
    )
    op.create_index(
        "idx_user_consents_current",
        "user_consents",
        ["user_id", "document_id", sa.literal_column("occurred_at").desc()],
    )
    op.create_index(
        "idx_upload_intents_user_created",
        "upload_intents",
        ["user_id", sa.literal_column("created_at").desc()],
    )
    op.create_index(
        "idx_upload_intents_expiry", "upload_intents", ["status", "expires_at"]
    )
    op.create_index(
        "idx_practice_sessions_user_visible_created",
        "practice_sessions",
        ["user_id", sa.literal_column("created_at").desc()],
        postgresql_where=sa.text("hidden_at IS NULL"),
    )
    op.create_index(
        "idx_practice_sessions_user", "practice_sessions", ["user_id"]
    )
    op.create_index(
        "idx_practice_sessions_status_updated",
        "practice_sessions",
        ["status", "updated_at"],
    )
    op.create_index("idx_summaries_session", "summaries", ["session_id"])
    op.create_index(
        "idx_anomalies_summary", "anomalies", ["summary_id", "sort_order"]
    )
    op.create_index("idx_sessions_summary", "coach_sessions", ["summary_id"])
    op.create_index(
        "idx_turns_session", "coach_turns", ["session_id", "turn_index"]
    )
    op.create_index(
        "idx_reports_created",
        "reports",
        [sa.literal_column("created_at").desc()],
    )
    op.create_index(
        "idx_external_operations_claimable",
        "external_operations",
        ["kind", "status", "created_at"],
    )
    op.create_index(
        "idx_external_operations_session", "external_operations", ["session_id"]
    )
    op.create_index(
        "idx_external_operations_status_attempt_lease",
        "external_operations",
        ["status", "attempt_count", "lease_expires_at"],
    )


def downgrade() -> None:
    op.drop_table("external_operations")
    op.drop_table("reports")
    op.drop_table("coach_turns")
    op.drop_table("coach_sessions")
    op.drop_table("anomalies")
    op.drop_table("summaries")
    op.drop_table("practice_sessions")
    op.drop_table("upload_intents")
    op.drop_table("user_consents")
    op.drop_table("refresh_tokens")
    op.drop_table("user_identities")
    op.drop_table("consent_documents")
    op.drop_table("users")

    bind = op.get_bind()
    for enum_type in reversed(ENUMS):
        enum_type.drop(bind, checkfirst=False)
