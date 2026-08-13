"""Store signup utm_id attribution.

Revision ID: 0015_signup_utm_id
Revises: 0014_signup_attribution
Create Date: 2026-08-13
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0015_signup_utm_id"
down_revision: str | Sequence[str] | None = "0014_signup_attribution"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users", sa.Column("signup_utm_id", sa.String(length=255), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("users", "signup_utm_id")
