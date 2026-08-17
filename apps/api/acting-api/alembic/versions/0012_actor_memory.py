"""Store the per-actor memory the coach carries across practices.

칸을 컬럼으로 늘어놓지 않고 한 칸이 한 행이다. 칸마다 "누가 마지막으로 썼는지"와
"어느 연습에서 나왔는지"를 따로 들고 있어야 하는데, 컬럼으로 하면 6칸 × 메타 3개로
표가 넓어지고 칸이 늘 때마다 마이그레이션이 필요하다.

written_by 가 이 표의 핵심이다. 'actor' 면 배우가 직접 쓰거나 고친 칸이라
에이전트가 덮지 않는다. 이 규칙이 없으면 배우가 고쳐도 다음 연습에 되돌아가고,
그러면 고치는 화면 자체가 무의미해진다.

성별·나이는 배우만 쓴다. 영상이나 목소리에서 추론하지 않는다.

Revision ID: 0012_actor_memory
Revises: 0011_user_deactivation
Create Date: 2026-08-11
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0012_actor_memory"
down_revision: str | Sequence[str] | None = "0011_user_deactivation"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# 프롬프트에 6칸이 통째로 들어가므로 한 칸이 길어지면 대화 맥락을 밀어낸다.
# 실측 후 조정한다.
_VALUE_MAX = 1000


def upgrade() -> None:
    field = postgresql.ENUM(
        "gender",
        "age",
        "goal",
        "blockage",
        "speech_self",
        "speech_actual",
        name="actor_memory_field_t",
        create_type=False,
    )
    author = postgresql.ENUM(
        "actor",
        "agent",
        name="actor_memory_author_t",
        create_type=False,
    )
    field.create(op.get_bind(), checkfirst=True)
    author.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "actor_memory_entries",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("field", field, nullable=False),
        sa.Column("value", sa.Text(), nullable=False),
        # 배우가 쓴 칸인지 에이전트가 쓴 칸인지. 배우 것은 에이전트가 덮지 않는다.
        sa.Column("written_by", author, nullable=False),
        # 에이전트가 쓴 칸의 근거가 된 연습. 배우가 "이게 왜 이렇게 적혔지" 를
        # 확인할 수 있어야 고칠지 판단이 선다. 그 연습이 지워져도 칸은 남긴다.
        sa.Column(
            "source_practice_session_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["source_practice_session_id"],
            ["practice_sessions.id"],
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id"),
        # 한 배우가 같은 칸을 두 개 가질 수 없다. 갱신은 UPSERT 로 한다.
        sa.UniqueConstraint("user_id", "field", name="uq_actor_memory_user_field"),
        sa.CheckConstraint(
            f"char_length(value) <= {_VALUE_MAX}",
            name="ck_actor_memory_value_length",
        ),
        # 빈 칸은 값이 없는 게 아니라 행이 없는 것이다. 공백만 든 행을 막는다.
        sa.CheckConstraint(
            "btrim(value) <> ''", name="ck_actor_memory_value_not_blank"
        ),
        # 성별·나이는 배우만 쓴다. 에이전트가 영상에서 추론해 넣지 못하게
        # 데이터베이스에서 막는다 -- 코드 한 곳만 고쳐도 뚫리면 안 되는 규칙이다.
        sa.CheckConstraint(
            "field NOT IN ('gender', 'age') OR written_by = 'actor'",
            name="ck_actor_memory_demographics_actor_only",
        ),
    )
    # 프롬프트를 만들 때 한 배우의 6칸을 한 번에 읽는다.
    op.create_index(
        "idx_actor_memory_user", "actor_memory_entries", ["user_id"]
    )


def downgrade() -> None:
    op.drop_index("idx_actor_memory_user", table_name="actor_memory_entries")
    op.drop_table("actor_memory_entries")
    op.execute("DROP TYPE IF EXISTS actor_memory_author_t")
    op.execute("DROP TYPE IF EXISTS actor_memory_field_t")
