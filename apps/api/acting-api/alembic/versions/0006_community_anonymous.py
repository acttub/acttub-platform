"""Let posts and comments be written anonymously.

글·댓글마다 익명 여부를 따로 켠다. 표시 이름은 글 단위 번호(익명1·익명2)이고, 그
번호는 `community_anonymous_aliases` 에 저장한다 — 댓글이 커서로 나뉘어 오면 그때그때
세는 방식으로는 같은 사람이 페이지마다 다른 번호를 받는다.

기존 글·댓글은 전부 `anonymous=false` 로 남는다.

Revision ID: 0006_community_anonymous
Revises: 0005_user_nickname_and_community
Create Date: 2026-08-01
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0006_community_anonymous"
down_revision: str | Sequence[str] | None = "0005_user_nickname_and_community"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    for table in ("community_posts", "community_comments"):
        op.add_column(
            table,
            sa.Column(
                "anonymous",
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("false"),
            ),
        )

    op.create_table(
        "community_anonymous_aliases",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "post_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("community_posts.id"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id"),
            nullable=False,
        ),
        sa.Column("ordinal", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint("post_id", "user_id", name="uq_community_alias_post_user"),
        # 번호가 겹치면 서로 다른 사람이 같은 익명으로 보인다. DB 가 막는다.
        sa.UniqueConstraint(
            "post_id", "ordinal", name="uq_community_alias_post_ordinal"
        ),
    )
    op.create_index(
        "idx_community_alias_post",
        "community_anonymous_aliases",
        ["post_id", "ordinal"],
    )


def downgrade() -> None:
    op.drop_table("community_anonymous_aliases")
    for table in ("community_comments", "community_posts"):
        op.drop_column(table, "anonymous")
