"""Enforce one summary per practice session.

앱 로직(상태 전이: ANALYZED에서 재분석 불가)이 이미 세션당 성공 분석 1회를
전제하므로, 그 불변식을 DB 제약으로 명시한다. 기존 idx_summaries_session은
UNIQUE 제약의 인덱스와 중복되어 제거한다.

Revision ID: 0004_unique_summary_per_session
Revises: 0003_rename_dev_provider
Create Date: 2026-07-22
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0004_unique_summary_per_session"
down_revision: str | Sequence[str] | None = "0003_rename_dev_provider"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_unique_constraint(
        "summaries_session_id_key", "summaries", ["session_id"]
    )
    op.drop_index("idx_summaries_session", table_name="summaries")


def downgrade() -> None:
    op.create_index("idx_summaries_session", "summaries", ["session_id"])
    op.drop_constraint("summaries_session_id_key", "summaries", type_="unique")
