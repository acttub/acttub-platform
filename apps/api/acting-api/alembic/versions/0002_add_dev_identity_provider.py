"""Add the opt-in local development identity provider.

Revision ID: 0002_add_dev_identity_provider
Revises: 0001_initial_schema
Create Date: 2026-07-18
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "0002_add_dev_identity_provider"
down_revision: str | Sequence[str] | None = "0001_initial_schema"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("ALTER TYPE identity_provider_t ADD VALUE IF NOT EXISTS 'dev'")


def downgrade() -> None:
    bind = op.get_bind()
    dev_identity_count = bind.scalar(
        sa.text(
            "SELECT count(*) FROM user_identities "
            "WHERE provider::text = 'dev'"
        )
    )
    if dev_identity_count:
        raise RuntimeError(
            "cannot remove the dev identity provider while dev identities exist"
        )
    op.execute(
        "ALTER TABLE user_identities ALTER COLUMN provider "
        "TYPE text USING provider::text"
    )
    op.execute("DROP TYPE identity_provider_t")
    op.execute(
        "CREATE TYPE identity_provider_t AS ENUM ('google', 'kakao', 'apple')"
    )
    op.execute(
        "ALTER TABLE user_identities ALTER COLUMN provider "
        "TYPE identity_provider_t USING provider::identity_provider_t"
    )
