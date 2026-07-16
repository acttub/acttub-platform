"""Create the initial PostgreSQL schema.

Revision ID: 0001_initial_schema
Revises:
Create Date: 2026-07-16
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0001_initial_schema"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

intent_impact_t = postgresql.ENUM(
    "반전", "약화", "국소", name="intent_impact_t", create_type=False
)
severity_t = postgresql.ENUM("high", "mid", "low", name="severity_t", create_type=False)
session_status_t = postgresql.ENUM(
    "open", "closed", name="session_status_t", create_type=False
)
close_reason_t = postgresql.ENUM(
    "gap_stated",
    "exhausted",
    "limit",
    "user_ended",
    name="close_reason_t",
    create_type=False,
)
turn_role_t = postgresql.ENUM("ai", "actor", name="turn_role_t", create_type=False)


def upgrade() -> None:
    bind = op.get_bind()
    intent_impact_t.create(bind, checkfirst=False)
    severity_t.create(bind, checkfirst=False)
    session_status_t.create(bind, checkfirst=False)
    close_reason_t.create(bind, checkfirst=False)
    turn_role_t.create(bind, checkfirst=False)

    op.create_table(
        "users",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("external_id", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("external_id"),
    )
    op.create_table(
        "api_keys",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("key_hash", sa.Text(), nullable=False),
        sa.Column("label", sa.Text(), nullable=False),
        sa.Column(
            "rate_limit_per_min",
            sa.Integer(),
            server_default=sa.text("10"),
            nullable=False,
        ),
        sa.Column(
            "is_active",
            sa.Boolean(),
            server_default=sa.text("true"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("key_hash"),
    )
    op.create_table(
        "scenes",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("situation", sa.Text(), nullable=False),
        sa.Column("character", sa.Text(), nullable=False),
        sa.Column("subtext", sa.Text(), nullable=False),
        sa.Column("video_filename", sa.Text(), nullable=True),
        sa.Column("video_size_bytes", sa.BigInteger(), nullable=True),
        sa.Column(
            "was_compressed",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.Column("model", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "summaries",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("scene_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "observation",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
        ),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("intent_alignment", sa.Text(), nullable=False),
        sa.Column("key_moment", sa.Text(), nullable=False),
        sa.Column("key_dimension", sa.Text(), nullable=False),
        sa.Column("raw", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["scene_id"], ["scenes.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "anomalies",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("summary_id", postgresql.UUID(as_uuid=True), nullable=False),
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
        sa.ForeignKeyConstraint(["summary_id"], ["summaries.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "coach_sessions",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("summary_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "status",
            session_status_t,
            server_default=sa.text("'open'"),
            nullable=False,
        ),
        sa.Column("close_reason", close_reason_t, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["summary_id"], ["summaries.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "coach_turns",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("session_id", postgresql.UUID(as_uuid=True), nullable=False),
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
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["session_id"], ["coach_sessions.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("session_id", "turn_index"),
    )
    op.create_table(
        "reports",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("session_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("headline", sa.Text(), nullable=False),
        sa.Column(
            "biggest_problem",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
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
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["session_id"], ["coach_sessions.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("session_id"),
    )

    op.create_index("idx_turns_session", "coach_turns", ["session_id", "turn_index"])
    op.create_index("idx_anomalies_summary", "anomalies", ["summary_id", "sort_order"])
    op.create_index(
        "idx_scenes_user",
        "scenes",
        ["user_id", sa.literal_column("created_at").desc()],
    )
    op.create_index("idx_summaries_scene", "summaries", ["scene_id"])
    op.create_index("idx_sessions_summary", "coach_sessions", ["summary_id"])


def downgrade() -> None:
    op.drop_index("idx_sessions_summary", table_name="coach_sessions")
    op.drop_index("idx_summaries_scene", table_name="summaries")
    op.drop_index("idx_scenes_user", table_name="scenes")
    op.drop_index("idx_anomalies_summary", table_name="anomalies")
    op.drop_index("idx_turns_session", table_name="coach_turns")

    op.drop_table("reports")
    op.drop_table("coach_turns")
    op.drop_table("coach_sessions")
    op.drop_table("anomalies")
    op.drop_table("summaries")
    op.drop_table("scenes")
    op.drop_table("api_keys")
    op.drop_table("users")

    bind = op.get_bind()
    turn_role_t.drop(bind, checkfirst=False)
    close_reason_t.drop(bind, checkfirst=False)
    session_status_t.drop(bind, checkfirst=False)
    severity_t.drop(bind, checkfirst=False)
    intent_impact_t.drop(bind, checkfirst=False)
