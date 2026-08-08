"""Add the self-service account deactivation state.

탈퇴는 행을 지우지 않는다. 커뮤니티 글·연습 기록이 user_id 를 참조하고 있어
지우면 남의 화면이 깨지고, 신고 처리에도 원문 작성자가 필요하다. 상태만 바꾼다.

Revision ID: 0011_user_deactivation
Revises: 0010_prompt_context
Create Date: 2026-08-08
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0011_user_deactivation"
down_revision: str | Sequence[str] | None = "0010_prompt_context"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # enum 값 추가는 넓히는 방향이라 배포 중간 상태에서 안전하다 — 구버전 코드는
    # 이 값을 만들지 않고, 만들지 않으면 읽을 일도 없다.
    op.execute("ALTER TYPE user_status_t ADD VALUE IF NOT EXISTS 'deactivated'")
    op.add_column(
        "users",
        sa.Column("deactivated_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    bind = op.get_bind()
    deactivated_count = bind.scalar(
        sa.text("SELECT count(*) FROM users WHERE status::text = 'deactivated'")
    )
    if deactivated_count:
        raise RuntimeError(
            "cannot remove the deactivated user status while deactivated users exist"
        )
    op.drop_column("users", "deactivated_at")
    # 컬럼 default 가 옛 타입을 참조하고 있어 먼저 떼야 타입을 갈아끼울 수 있다.
    op.execute("ALTER TABLE users ALTER COLUMN status DROP DEFAULT")
    op.execute("ALTER TABLE users ALTER COLUMN status TYPE text USING status::text")
    op.execute("DROP TYPE user_status_t")
    op.execute("CREATE TYPE user_status_t AS ENUM ('active', 'suspended')")
    op.execute(
        "ALTER TABLE users ALTER COLUMN status "
        "TYPE user_status_t USING status::user_status_t"
    )
    op.execute("ALTER TABLE users ALTER COLUMN status SET DEFAULT 'active'")
