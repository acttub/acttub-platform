"""Rename the local development identity provider value.

Revision ID: 0003_rename_dev_provider
Revises: 0002_add_dev_identity_provider
Create Date: 2026-07-20
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0003_rename_dev_provider"
down_revision: str | Sequence[str] | None = "0002_add_dev_identity_provider"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        "ALTER TYPE identity_provider_t RENAME VALUE 'dev' TO 'development'"
    )


def downgrade() -> None:
    op.execute(
        "ALTER TYPE identity_provider_t RENAME VALUE 'development' TO 'dev'"
    )
