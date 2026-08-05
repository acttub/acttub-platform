"""Store prompt summaries and link sessions by reusable uploads.

Revision ID: 0010_prompt_context
Revises: 0009_observation_packs
Create Date: 2026-08-06
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0010_prompt_context"
down_revision: str | Sequence[str] | None = "0009_observation_packs"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "coach_sessions",
        sa.Column(
            "conversation_summary",
            sa.Text(),
            server_default=sa.text("''"),
            nullable=False,
        ),
    )
    op.drop_constraint(
        "practice_sessions_upload_intent_id_key",
        "practice_sessions",
        type_="unique",
    )
    op.create_index(
        "idx_practice_sessions_upload_intent",
        "practice_sessions",
        ["upload_intent_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "idx_practice_sessions_upload_intent",
        table_name="practice_sessions",
    )
    op.create_unique_constraint(
        "practice_sessions_upload_intent_id_key",
        "practice_sessions",
        ["upload_intent_id"],
    )
    op.drop_column("coach_sessions", "conversation_summary")
