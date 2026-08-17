"""Backfill the memory schema where 0012·0013 never ran.

운영 DB 는 `0011 → 0014 → 0015` 를 밟았고 dev 는 `0011 → 0012 → 0013 → 0014 → 0015`
를 밟았다. 같은 이름의 `0014` 가 두 브랜치에서 서로 다른 `down_revision` 을 갖고
있었기 때문이다(main=`0011`, dev=`0013`). 그래서 **운영에는 `actor_memory_entries`
와 `operation_kind_t.memory_update` 가 없는데 `alembic_version` 은 이미 `0015`** 다.

alembic 은 지나온 경로가 아니라 **현재 리비전만** 들고 있으므로, 그 상태에서
`upgrade head` 는 아무것도 하지 않는다 -- 건너뛴 둘은 영영 적용되지 않는다.
자바 백엔드는 그 표와 enum 값을 요구하므로(`MemoryUpdateQueue`), 운영 컷오버
전에 메워야 한다(SOMA-394).

**그래서 이 리비전은 모든 연산이 멱등이다.** 두 종류의 DB 가 같은 head 로 모인다.

- 0012·0013 을 건너뛴 DB(운영): 표·enum 을 만든다
- 이미 거친 DB(dev, 그리고 빈 DB 에서 전체 체인을 밟는 신규 환경): 아무것도 하지 않는다

빠진 것을 **새 리비전으로 메우는** 이유는, 0012·0013 을 0015 뒤로 옮기는 방법이
dev 를 깨기 때문이다 -- dev 는 그 둘을 이미 적용했지만 `alembic_version` 은 `0015`
라, 번호만 바꾸면 `create_table` 이 다시 돌아 충돌한다.

표의 모양은 `0012_actor_memory` 와 **글자까지 같아야 한다.** 두 경로로 만들어진
스키마가 갈리면 `FlywayBaselineTest` 의 fingerprint 대조가 그것을 잡는다.

Revision ID: 0016_backfill_memory_schema
Revises: 0015_signup_utm_id
Create Date: 2026-08-17
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0016_backfill_memory_schema"
down_revision: str | Sequence[str] | None = "0015_signup_utm_id"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# 0012 와 같은 값이다. 여기서 갈리면 두 경로의 CHECK 제약이 달라진다.
_VALUE_MAX = 1000


def upgrade() -> None:
    bind = op.get_bind()

    # enum 둘은 0012 와 같은 방식이라 이미 멱등이다(checkfirst).
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
    field.create(bind, checkfirst=True)
    author.create(bind, checkfirst=True)

    # `op.create_table` 에는 checkfirst 가 없다. 표가 이미 있으면 건너뛴다 --
    # raw `CREATE TABLE IF NOT EXISTS` 로 다시 쓰지 않는 이유는 제약 이름·기본값이
    # 0012 와 미묘하게 갈릴 수 있어서다. 아래는 0012 의 정의를 그대로 옮긴 것이다.
    if bind.execute(
        sa.text("SELECT to_regclass('public.actor_memory_entries')")
    ).scalar() is None:
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
            sa.Column("written_by", author, nullable=False),
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
            sa.UniqueConstraint("user_id", "field", name="uq_actor_memory_user_field"),
            sa.CheckConstraint(
                f"char_length(value) <= {_VALUE_MAX}",
                name="ck_actor_memory_value_length",
            ),
            sa.CheckConstraint(
                "btrim(value) <> ''", name="ck_actor_memory_value_not_blank"
            ),
            sa.CheckConstraint(
                "field NOT IN ('gender', 'age') OR written_by = 'actor'",
                name="ck_actor_memory_demographics_actor_only",
            ),
        )
        op.create_index(
            "idx_actor_memory_user", "actor_memory_entries", ["user_id"]
        )

    # 0013 과 같은 문장이라 이미 멱등이다.
    op.execute("ALTER TYPE operation_kind_t ADD VALUE IF NOT EXISTS 'memory_update'")


def downgrade() -> None:
    # **되돌리지 않는다.** 이 리비전은 빠진 것을 메울 뿐이라, 내리면서 표를 지우면
    # 0012 를 거쳐 온 DB(dev)에서 남의 마이그레이션 산출물을 지우게 된다. 표를
    # 없애야 한다면 그것은 0012 의 downgrade 가 할 일이다.
    pass
