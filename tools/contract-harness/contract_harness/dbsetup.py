"""독립 스키마 2벌을 만들고 같은 시드를 넣는다.

`apps/api/acting-api/tests/db_test_support.py:postgres_schema` 가 쓰는
`search_path` 스코프 방식을 그대로 빌린다. 다만 스키마 이름을 고정해 두고
(`harness_baseline`/`harness_target`) 한 번만 alembic 을 올린 뒤,
실행 사이에는 TRUNCATE 로 되돌린다 — self-test 가 수십 번 도는 것을 5분 안에
끝내려면 매번 마이그레이션을 다시 올릴 수 없다.
"""

from __future__ import annotations

import os
from contextlib import contextmanager

from alembic import command
from alembic.config import Config
from sqlalchemy import text
from sqlalchemy.engine import make_url

from acting_api.db.engine import create_db_engine, normalize_database_url

from contract_harness import config as cfg


def scoped_url(database_url: str, schema: str) -> str:
    url = make_url(normalize_database_url(database_url)).update_query_dict(
        {"options": f"-csearch_path={schema}"}
    )
    return url.render_as_string(hide_password=False)


@contextmanager
def _env(**values: str):
    previous = {key: os.environ.get(key) for key in values}
    os.environ.update(values)
    try:
        yield
    finally:
        for key, value in previous.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


def _schema_is_migrated(admin_engine, schema: str) -> bool:
    with admin_engine.connect() as connection:
        exists = connection.execute(
            text(
                "SELECT 1 FROM information_schema.tables "
                "WHERE table_schema = :schema AND table_name = 'alembic_version'"
            ),
            {"schema": schema},
        ).first()
        if exists is None:
            return False
        head = connection.execute(
            text(f'SELECT version_num FROM "{schema}".alembic_version')
        ).first()
        return head is not None


def ensure_schema(database_url: str, schema: str, *, force: bool = False) -> str:
    """스키마를 만들고 alembic head 까지 올린다. 이미 올라가 있으면 건너뛴다."""
    admin_engine = create_db_engine(database_url)
    try:
        with admin_engine.begin() as connection:
            if force:
                connection.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
            connection.execute(text(f'CREATE SCHEMA IF NOT EXISTS "{schema}"'))
        url = scoped_url(database_url, schema)
        if force or not _schema_is_migrated(admin_engine, schema):
            import logging

            alembic_config = Config(str(cfg.ACTING_API_ROOT / "alembic.ini"))
            alembic_config.set_main_option(
                "script_location", str(cfg.ACTING_API_ROOT / "alembic")
            )
            logging.getLogger("alembic").setLevel(logging.WARNING)
            with _env(DATABASE_URL=url):
                command.upgrade(alembic_config, "head")
        return url
    finally:
        admin_engine.dispose()


def truncate(database_url: str, schema: str) -> None:
    """시드를 제외한 전 테이블을 비운다."""
    engine = create_db_engine(scoped_url(database_url, schema))
    try:
        with engine.begin() as connection:
            names = [
                row[0]
                for row in connection.execute(
                    text(
                        "SELECT table_name FROM information_schema.tables "
                        "WHERE table_schema = :schema AND table_type = 'BASE TABLE'"
                    ),
                    {"schema": schema},
                )
            ]
            targets = [
                f'"{schema}"."{name}"'
                for name in sorted(names)
                if name not in cfg.TRUNCATE_EXCLUDE
            ]
            if targets:
                connection.execute(
                    text(
                        "TRUNCATE TABLE "
                        + ", ".join(targets)
                        + " RESTART IDENTITY CASCADE"
                    )
                )
    finally:
        engine.dispose()


SEEDED_TABLES = (
    "users",
    "user_identities",
    "refresh_tokens",
    "consent_documents",
    "user_consents",
    "upload_intents",
    "practice_sessions",
    "summaries",
    "coach_sessions",
    "coaching_handoffs",
    "practice_reports",
    "community_posts",
    "community_comments",
    "community_anonymous_aliases",
)

# alembic 0005 가 `gen_random_uuid()` 로 만드는 카테고리 id 는 스키마마다 다르다.
# API 응답에는 slug·name·description 만 나가므로(community.py:CategoryPayload)
# 이 컬럼만 지문에서 뺀다.
FINGERPRINT_EXCLUDED_COLUMNS = {("community_posts", "category_id")}


def seed_fingerprint(database_url: str, schema: str) -> str:
    """시드가 만든 행 전체의 지문. 두 스키마가 같아야 한다.

    고정 UUID와 고정 시각을 쓰므로 두 스키마의 지문은 바이트까지 같아야 한다.
    community_categories 는 alembic 이 `gen_random_uuid()` 로 만들어 스키마마다
    다르므로 제외한다 — 그 id 는 API 응답에 나오지 않는다(slug 만 노출).
    """
    import hashlib

    engine = create_db_engine(scoped_url(database_url, schema))
    digest = hashlib.sha256()
    try:
        with engine.connect() as connection:
            for table in SEEDED_TABLES:
                columns = [
                    row[0]
                    for row in connection.execute(
                        text(
                            "SELECT column_name FROM information_schema.columns"
                            " WHERE table_schema = :schema AND table_name = :table"
                            " ORDER BY column_name"
                        ),
                        {"schema": schema, "table": table},
                    )
                ]
                columns = [
                    name
                    for name in columns
                    if (table, name) not in FINGERPRINT_EXCLUDED_COLUMNS
                ]
                selected = ", ".join(f'"{name}"::text' for name in columns)
                rows = connection.execute(
                    text(
                        f'SELECT {selected} FROM "{schema}"."{table}"'
                        f" ORDER BY {', '.join(str(i + 1) for i in range(len(columns)))}"
                    )
                ).all()
                digest.update(table.encode())
                for row in rows:
                    digest.update(repr(tuple(row)).encode())
    finally:
        engine.dispose()
    return digest.hexdigest()


def drop_schema(database_url: str, schema: str) -> None:
    engine = create_db_engine(database_url)
    try:
        with engine.begin() as connection:
            connection.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
    finally:
        engine.dispose()
