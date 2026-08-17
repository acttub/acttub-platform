"""Store first-touch attribution on signup.

Revision ID: 0014_signup_attribution
Revises: 0013_memory_update_operation
Create Date: 2026-08-12
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0014_signup_attribution"
down_revision: str | Sequence[str] | None = "0013_memory_update_operation"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    for name in (
        "signup_utm_source",
        "signup_utm_medium",
        "signup_utm_campaign",
        "signup_utm_content",
        "signup_utm_term",
        "signup_referrer_host",
        "signup_landing_path",
    ):
        op.add_column("users", sa.Column(name, sa.String(length=255), nullable=True))
    op.add_column(
        "users",
        sa.Column("signup_first_seen_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("users", "signup_first_seen_at")
    for name in (
        "signup_landing_path",
        "signup_referrer_host",
        "signup_utm_term",
        "signup_utm_content",
        "signup_utm_campaign",
        "signup_utm_medium",
        "signup_utm_source",
    ):
        op.drop_column("users", name)
