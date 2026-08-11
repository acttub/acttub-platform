"""Let the background queue carry a memory-update job.

기억 갱신을 연습 마무리 응답 안에서 처리하면 배우가 모델 호출 한 번만큼 더
기다린다. 그 화면은 이미 성적표를 만드느라 느리다. 그래서 분석이 쓰던 작업 큐에
종류 하나를 더한다 -- lease·재시도·실패 처리가 이미 거기 있다.

Postgres 는 enum 값을 지우지 못하므로 되돌리기는 값을 남긴 채 아무것도 하지 않는다.
쓰지 않는 값이 하나 남는 것은 해가 없지만, 표를 다시 만들면 그마저도 사라진다.

Revision ID: 0013_memory_update_operation
Revises: 0012_actor_memory
Create Date: 2026-08-11
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0013_memory_update_operation"
down_revision: str | Sequence[str] | None = "0012_actor_memory"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("ALTER TYPE operation_kind_t ADD VALUE IF NOT EXISTS 'memory_update'")


def downgrade() -> None:
    # Postgres 는 enum 값 제거를 지원하지 않는다. 쓰지 않는 값으로 남겨 둔다.
    pass
