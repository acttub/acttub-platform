"""Add user nickname and the community board tables.

닉네임은 지금까지 웹 localStorage·앱 AsyncStorage 에만 있었다. 커뮤니티에서 남에게
보이는 이름이 되므로 서버로 옮긴다. UNIQUE 는 일부러 걸지 않는다 (models.py 주석 참고).

게시판은 글·댓글·좋아요·신고·차단 다섯 테이블이다. 카테고리는 배포 없이 늘릴 수
있도록 행으로 두고 초기 세 개를 여기서 넣는다.

Revision ID: 0005_user_nickname_and_community
Revises: 0004_unique_summary_per_session
Create Date: 2026-08-01
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0005_user_nickname_and_community"
down_revision: str | Sequence[str] | None = "0004_unique_summary_per_session"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


content_status = postgresql.ENUM(
    "visible", "hidden", "deleted", name="content_status_t", create_type=False
)
report_target_type = postgresql.ENUM(
    "post", "comment", name="report_target_type_t", create_type=False
)
report_reason = postgresql.ENUM(
    "spam", "abuse", "sexual", "privacy", "other", name="report_reason_t",
    create_type=False,
)
report_status = postgresql.ENUM(
    "pending", "actioned", "dismissed", name="report_status_t", create_type=False
)

_SEED_CATEGORIES = (
    ("free", "자유", "연습하다 든 생각, 근황, 잡담", 10),
    ("admission", "입시 Q&A", "실기·전형·준비 과정에서 막힌 것 묻기", 20),
    ("info", "정보공유", "공고·후기·자료처럼 남에게 도움 되는 것", 30),
)


def upgrade() -> None:
    op.add_column("users", sa.Column("nickname", sa.Text(), nullable=True))

    content_status.create(op.get_bind(), checkfirst=True)
    report_target_type.create(op.get_bind(), checkfirst=True)
    report_reason.create(op.get_bind(), checkfirst=True)
    report_status.create(op.get_bind(), checkfirst=True)

    categories = op.create_table(
        "community_categories",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("slug", sa.Text(), nullable=False, unique=True),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("description", sa.Text()),
        sa.Column(
            "sort_order", sa.Integer(), nullable=False, server_default=sa.text("0")
        ),
        sa.Column(
            "is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.bulk_insert(
        categories,
        [
            {"slug": slug, "name": name, "description": description, "sort_order": order}
            for slug, name, description, order in _SEED_CATEGORIES
        ],
    )

    op.create_table(
        "community_posts",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "category_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("community_categories.id"),
            nullable=False,
        ),
        sa.Column(
            "author_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id"),
            nullable=False,
        ),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column(
            "status", content_status, nullable=False, server_default=sa.text("'visible'")
        ),
        sa.Column(
            "like_count", sa.Integer(), nullable=False, server_default=sa.text("0")
        ),
        sa.Column(
            "comment_count", sa.Integer(), nullable=False, server_default=sa.text("0")
        ),
        sa.Column(
            "view_count", sa.Integer(), nullable=False, server_default=sa.text("0")
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "idx_community_posts_category_created",
        "community_posts",
        ["category_id", sa.text("created_at DESC"), sa.text("id DESC")],
        postgresql_where=sa.text("status = 'visible'"),
    )
    op.create_index(
        "idx_community_posts_created",
        "community_posts",
        [sa.text("created_at DESC"), sa.text("id DESC")],
        postgresql_where=sa.text("status = 'visible'"),
    )
    op.create_index("idx_community_posts_author", "community_posts", ["author_id"])

    op.create_table(
        "community_comments",
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
            "author_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id"),
            nullable=False,
        ),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column(
            "status", content_status, nullable=False, server_default=sa.text("'visible'")
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "idx_community_comments_post_created",
        "community_comments",
        ["post_id", "created_at", "id"],
    )
    op.create_index("idx_community_comments_author", "community_comments", ["author_id"])

    op.create_table(
        "community_post_likes",
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
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint("post_id", "user_id", name="uq_community_post_likes"),
    )
    op.create_index("idx_community_post_likes_user", "community_post_likes", ["user_id"])

    op.create_table(
        "community_reports",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "reporter_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id"),
            nullable=False,
        ),
        sa.Column("target_type", report_target_type, nullable=False),
        sa.Column("target_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("reason", report_reason, nullable=False),
        sa.Column("detail", sa.Text()),
        sa.Column(
            "status", report_status, nullable=False, server_default=sa.text("'pending'")
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint(
            "reporter_id",
            "target_type",
            "target_id",
            name="uq_community_reports_reporter_target",
        ),
    )
    op.create_index(
        "idx_community_reports_status_created",
        "community_reports",
        ["status", sa.text("created_at DESC")],
    )

    op.create_table(
        "community_blocks",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "blocker_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id"),
            nullable=False,
        ),
        sa.Column(
            "blocked_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint("blocker_id", "blocked_id", name="uq_community_blocks_pair"),
        sa.CheckConstraint("blocker_id <> blocked_id", name="ck_community_blocks_not_self"),
    )
    op.create_index("idx_community_blocks_blocker", "community_blocks", ["blocker_id"])


def downgrade() -> None:
    op.drop_table("community_blocks")
    op.drop_table("community_reports")
    op.drop_table("community_post_likes")
    op.drop_table("community_comments")
    op.drop_table("community_posts")
    op.drop_table("community_categories")

    report_status.drop(op.get_bind(), checkfirst=True)
    report_reason.drop(op.get_bind(), checkfirst=True)
    report_target_type.drop(op.get_bind(), checkfirst=True)
    content_status.drop(op.get_bind(), checkfirst=True)

    op.drop_column("users", "nickname")
