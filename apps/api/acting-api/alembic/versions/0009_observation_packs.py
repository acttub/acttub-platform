"""Store observation packs and allow coaching before analysis.

Revision ID: 0009_observation_packs
Revises: 0008_transcripts
Create Date: 2026-08-05
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0009_observation_packs"
down_revision: str | Sequence[str] | None = "0008_transcripts"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("practice_sessions", sa.Column("goal", sa.Text(), nullable=True))
    op.execute("UPDATE practice_sessions SET goal = subtext")
    op.alter_column("practice_sessions", "goal", nullable=False)
    op.alter_column("practice_sessions", "subtext", nullable=True)

    op.add_column(
        "summaries",
        sa.Column(
            "observations_json",
            postgresql.JSONB(),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
    )
    op.add_column(
        "summaries",
        sa.Column(
            "uncertainties_json",
            postgresql.JSONB(),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
    )
    for column in (
        "observation",
        "summary",
        "intent_alignment",
        "key_moment",
        "key_dimension",
    ):
        op.alter_column("summaries", column, nullable=True)

    op.add_column(
        "coach_sessions",
        sa.Column("practice_session_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.execute(
        "UPDATE coach_sessions AS c "
        "SET practice_session_id = s.session_id "
        "FROM summaries AS s WHERE s.id = c.summary_id"
    )
    op.alter_column("coach_sessions", "practice_session_id", nullable=False)
    op.create_foreign_key(
        "fk_coach_sessions_practice_session_id",
        "coach_sessions",
        "practice_sessions",
        ["practice_session_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index(
        "idx_coach_sessions_practice",
        "coach_sessions",
        ["practice_session_id", "created_at"],
    )
    op.alter_column("coach_sessions", "summary_id", nullable=True)


def downgrade() -> None:
    # 분석 전에 시작된 코치 세션도 삭제하지 않는다. 구버전 스키마가 요구하는
    # summary FK를 빈 legacy 요약으로 채워 downgrade에서도 대화 기록을 보존한다.
    op.execute(
        "INSERT INTO summaries "
        "(id, session_id, observations_json, uncertainties_json, observation, "
        "summary, intent_alignment, key_moment, key_dimension, model, "
        "was_compressed, raw) "
        "SELECT gen_random_uuid(), pending.practice_session_id, '[]'::jsonb, "
        "'[]'::jsonb, '{}'::jsonb, '', '', '', '', 'migration-placeholder', "
        "false, '{\"observations\": [], \"uncertainties\": []}'::jsonb "
        "FROM (SELECT DISTINCT practice_session_id FROM coach_sessions "
        "WHERE summary_id IS NULL) AS pending "
        "LEFT JOIN summaries AS existing "
        "ON existing.session_id = pending.practice_session_id "
        "WHERE existing.id IS NULL"
    )
    op.execute(
        "UPDATE coach_sessions AS c SET summary_id = s.id "
        "FROM summaries AS s "
        "WHERE c.summary_id IS NULL AND s.session_id = c.practice_session_id"
    )
    op.alter_column("coach_sessions", "summary_id", nullable=False)
    op.drop_index("idx_coach_sessions_practice", table_name="coach_sessions")
    op.drop_constraint(
        "fk_coach_sessions_practice_session_id",
        "coach_sessions",
        type_="foreignkey",
    )
    op.drop_column("coach_sessions", "practice_session_id")

    op.execute("UPDATE summaries SET observation = '{}'::jsonb WHERE observation IS NULL")
    for column in ("summary", "intent_alignment", "key_moment", "key_dimension"):
        op.execute(f"UPDATE summaries SET {column} = '' WHERE {column} IS NULL")
        op.alter_column("summaries", column, nullable=False)
    op.alter_column("summaries", "observation", nullable=False)
    op.drop_column("summaries", "uncertainties_json")
    op.drop_column("summaries", "observations_json")

    op.execute("UPDATE practice_sessions SET subtext = goal WHERE subtext IS NULL")
    op.alter_column("practice_sessions", "subtext", nullable=False)
    op.drop_column("practice_sessions", "goal")
