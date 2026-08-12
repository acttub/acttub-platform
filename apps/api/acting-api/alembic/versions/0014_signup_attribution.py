"""Store first-touch attribution on signup.

Revision ID: 0014_signup_attribution
Revises: 0011_user_deactivation
Create Date: 2026-08-12

⚠️ 이 파일은 `main`(운영)에서만 `0011_user_deactivation` 을 부모로 갖는다.
`dev` 에서는 같은 리비전이 `0013_memory_update_operation` 을 부모로 갖는다.

이유: SOMA-328(배우 기억)이 2026-08-11 운영 릴리스에서 `9b1dc1d` 로 revert 돼
운영에는 `0012_actor_memory`·`0013_memory_update_operation` 이 없다. 배우 기억을
운영에 올리지 않기로 한 결정(2026-08-12)을 유지한 채 유입 저장만 내보내기 위해
운영 쪽 부모를 `0011` 로 둔다.

⚠️ **배우 기억을 운영에 올릴 때 이 갈라짐을 먼저 정리해야 한다.** 그때 운영의
`alembic_version` 은 이미 `0014_signup_attribution` 이라 `upgrade head` 가 아무것도
하지 않고 0012·0013 을 건너뛴다. 순서는 `alembic stamp 0011_user_deactivation` →
`alembic upgrade head`. 아래 upgrade 를 멱등으로 둔 것이 그 재실행을 위한 것이다.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0014_signup_attribution"
down_revision: str | Sequence[str] | None = "0011_user_deactivation"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TEXT_COLUMNS = (
    "signup_utm_source",
    "signup_utm_medium",
    "signup_utm_campaign",
    "signup_utm_content",
    "signup_utm_term",
    "signup_referrer_host",
    "signup_landing_path",
)


def upgrade() -> None:
    # IF NOT EXISTS — 위 주석의 stamp 후 재실행에서 같은 컬럼을 다시 만나도 죽지 않는다.
    for name in _TEXT_COLUMNS:
        op.execute(
            f'ALTER TABLE users ADD COLUMN IF NOT EXISTS {name} VARCHAR(255)'
        )
    op.execute(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS "
        "signup_first_seen_at TIMESTAMP WITH TIME ZONE"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS signup_first_seen_at")
    for name in reversed(_TEXT_COLUMNS):
        op.execute(f"ALTER TABLE users DROP COLUMN IF EXISTS {name}")
