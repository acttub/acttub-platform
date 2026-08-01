"""실제 PostgreSQL 위에서 도는 테스트용 스키마 fixture.

`acting_test_<uuid>` 스키마를 만들어 alembic 을 끝까지 올리고, 끝나면 통째로 지운다.
대상 DB 의 기존 데이터는 건드리지 않는다.

`RUN_DB_TESTS=1` 이 없으면 skip 된다 — 가짜 Session 을 쓰는 다른 테스트는 SQL 을
실행하지 않으므로, Postgres 가 거부하는 종류의 회귀는 여기서만 잡힌다.
"""

from __future__ import annotations

import os
from pathlib import Path
from uuid import uuid4

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import text
from sqlalchemy.engine import make_url

from acting_api.db.engine import create_db_engine, normalize_database_url


@pytest.fixture
def postgres_schema(monkeypatch):
    if os.environ.get("RUN_DB_TESTS") != "1":
        pytest.skip("set RUN_DB_TESTS=1 to run PostgreSQL integration tests")
    database_url = os.environ.get("TEST_DATABASE_URL") or os.environ.get("DATABASE_URL")
    if not database_url:
        pytest.skip("TEST_DATABASE_URL or DATABASE_URL is required")

    admin_engine = create_db_engine(database_url)
    schema = f"acting_test_{uuid4().hex}"
    with admin_engine.begin() as connection:
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))

    scoped = make_url(normalize_database_url(database_url)).update_query_dict(
        {"options": f"-csearch_path={schema}"}
    )
    scoped_url = scoped.render_as_string(hide_password=False)
    monkeypatch.setenv("DATABASE_URL", scoped_url)
    project_dir = Path(__file__).resolve().parents[1]
    alembic_config = Config(str(project_dir / "alembic.ini"))

    try:
        yield scoped_url, alembic_config
    finally:
        with admin_engine.begin() as connection:
            connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin_engine.dispose()


@pytest.fixture
def migrated_database(postgres_schema):
    scoped_url, alembic_config = postgres_schema
    command.upgrade(alembic_config, "head")
    return scoped_url
