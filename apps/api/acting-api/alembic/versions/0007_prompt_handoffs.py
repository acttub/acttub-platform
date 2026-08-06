"""Add blockage routing, coaching handoffs, and practice reports.

Revision ID: 0007_prompt_handoffs
Revises: 0006_community_anonymous
Create Date: 2026-08-05
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0007_prompt_handoffs"
down_revision: str | Sequence[str] | None = "0006_community_anonymous"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "practice_sessions", sa.Column("blockage_kind", sa.Text(), nullable=True)
    )
    op.add_column(
        "practice_sessions", sa.Column("sub_branch", sa.Text(), nullable=True)
    )
    op.add_column(
        "practice_sessions", sa.Column("blockage_detail", sa.Text(), nullable=True)
    )
    op.execute(
        "UPDATE practice_sessions SET blockage_kind = '그 외', sub_branch = '그 외'"
    )
    op.alter_column("practice_sessions", "blockage_kind", nullable=False)
    op.alter_column("practice_sessions", "sub_branch", nullable=False)
    op.create_check_constraint(
        "ck_practice_sessions_blockage_branch",
        "practice_sessions",
        "(blockage_kind = '분석' AND sub_branch IN ('캐릭터 분석', '대사 분석', '그 외')) OR "
        "(blockage_kind = '표현' AND sub_branch IN ('감정', '움직임', '화술', '표정', '그 외')) OR "
        "(blockage_kind = '그 외' AND sub_branch = '그 외')",
    )

    op.drop_column("coach_turns", "focus_timestamp")
    op.drop_column("coach_turns", "action")

    op.create_table(
        "coaching_handoffs",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("coach_session_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "practice_session_id", postgresql.UUID(as_uuid=True), nullable=False
        ),
        sa.Column("branch_kind", sa.Text(), nullable=False),
        sa.Column("handoff_json", postgresql.JSONB(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "branch_kind IN ('analysis', 'expression')",
            name="ck_coaching_handoffs_branch_kind",
        ),
        sa.ForeignKeyConstraint(
            ["coach_session_id"], ["coach_sessions.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["practice_session_id"],
            ["practice_sessions.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "idx_coaching_handoffs_session_created",
        "coaching_handoffs",
        ["coach_session_id", "created_at"],
    )
    op.create_index(
        "idx_coaching_handoffs_practice_created",
        "coaching_handoffs",
        ["practice_session_id", "created_at"],
    )

    op.create_table(
        "handoff_confirmations",
        sa.Column(
            "coaching_handoff_id", postgresql.UUID(as_uuid=True), nullable=False
        ),
        sa.Column(
            "confirmed", sa.Boolean(), server_default=sa.false(), nullable=False
        ),
        sa.Column("rebuttal_text", sa.Text(), nullable=True),
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
        sa.ForeignKeyConstraint(
            ["coaching_handoff_id"],
            ["coaching_handoffs.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("coaching_handoff_id"),
    )

    op.create_table(
        "practice_reports",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column(
            "practice_session_id", postgresql.UUID(as_uuid=True), nullable=False
        ),
        sa.Column("report_type", sa.Text(), nullable=False),
        sa.Column("report_json", postgresql.JSONB(), nullable=False),
        sa.Column(
            "source_handoff_id", postgresql.UUID(as_uuid=True), nullable=False
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "report_type IN ('analysis', 'expression')",
            name="ck_practice_reports_report_type",
        ),
        sa.ForeignKeyConstraint(
            ["practice_session_id"],
            ["practice_sessions.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["source_handoff_id"],
            ["coaching_handoffs.id"],
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "source_handoff_id", name="uq_practice_reports_source_handoff"
        ),
    )
    op.create_index(
        "idx_practice_reports_session_created",
        "practice_reports",
        ["practice_session_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "idx_practice_reports_session_created", table_name="practice_reports"
    )
    op.drop_table("practice_reports")
    op.drop_table("handoff_confirmations")
    op.drop_index(
        "idx_coaching_handoffs_practice_created", table_name="coaching_handoffs"
    )
    op.drop_index(
        "idx_coaching_handoffs_session_created", table_name="coaching_handoffs"
    )
    op.drop_table("coaching_handoffs")

    op.add_column(
        "coach_turns", sa.Column("action", sa.Text(), nullable=True)
    )
    op.add_column(
        "coach_turns",
        sa.Column(
            "focus_timestamp",
            sa.Text(),
            server_default=sa.text("''"),
            nullable=False,
        ),
    )

    op.drop_constraint(
        "ck_practice_sessions_blockage_branch",
        "practice_sessions",
        type_="check",
    )
    op.drop_column("practice_sessions", "blockage_detail")
    op.drop_column("practice_sessions", "sub_branch")
    op.drop_column("practice_sessions", "blockage_kind")
