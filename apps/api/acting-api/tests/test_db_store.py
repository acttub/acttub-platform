import os
from pathlib import Path
from uuid import uuid4

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import func, select, text
from sqlalchemy.engine import make_url

from acting_agent.schema import CoachSession, CoachTurn
from acting_agent.summary_schema import SceneSummary as AgentSceneSummary
from acting_agent.summary_schema import SubText as AgentSubText
from acting_api.db.engine import create_db_engine, normalize_database_url
from acting_api.db.models import Anomaly, Summary, User
from acting_api.db.store import PostgresStore
from acting_api.security import hash_api_key
from api_test_support import REPORT, SUBTEXT, SUMMARY

pytestmark = pytest.mark.db


@pytest.fixture
def postgres_store(monkeypatch):
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
    command.upgrade(Config(str(project_dir / "alembic.ini")), "head")

    store = PostgresStore.from_url(scoped_url)
    try:
        yield store
    finally:
        store.close()
        with admin_engine.begin() as connection:
            connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin_engine.dispose()


def test_postgres_store_full_reference_chain_and_immutable_summary(postgres_store):
    store = postgres_store

    key = store.create_api_key(
        key_hash=hash_api_key("act_test"),
        label="integration",
        rate_limit_per_min=23,
    )
    assert store.get_api_key_rate_limit(hash_api_key("act_test")) == 23
    assert store.revoke_api_key(key.id) is True
    assert store.get_api_key_rate_limit(hash_api_key("act_test")) is None

    summary_id = store.create_summary(
        user_id="external-u1",
        subtext=SUBTEXT,
        summary=SUMMARY,
        video_filename="scene.mp4",
        video_size_bytes=1234,
        was_compressed=True,
        model="gemini-test",
    )
    store.create_summary(
        user_id="external-u1",
        subtext=SUBTEXT,
        summary=SUMMARY,
        video_filename=None,
        video_size_bytes=10,
        was_compressed=False,
        model="gemini-test",
    )
    with store._session_factory() as db:
        assert db.scalar(select(func.count(User.id))) == 1
        immutable_counts = (
            db.scalar(select(func.count(Summary.id))),
            db.scalar(select(func.count(Anomaly.id))),
        )

    coach_summary, coach_subtext = store.get_summary(summary_id)
    assert isinstance(coach_summary, AgentSceneSummary)
    assert coach_subtext == AgentSubText.model_validate(SUBTEXT.model_dump())

    session_id = str(uuid4())
    session = CoachSession(
        session_id=session_id,
        summary_id=summary_id,
        summary=coach_summary,
        subtext=coach_subtext,
        turns=[
            CoachTurn(
                role="ai",
                text="첫 질문",
                action="probe_intent",
                focus_timestamp="00:12",
            )
        ],
        question_count=1,
    )
    store.create(session)
    loaded = store.get(session_id)
    assert loaded.question_count == 1
    loaded.turns.extend(
        [
            CoachTurn(role="actor", text="대사가 기억 안 났어요"),
            CoachTurn(role="ai", text="왜 그랬어?", action="dig_cause"),
        ]
    )
    loaded.question_count = 2
    store.save(loaded)
    assert store.get(session_id).question_count == 2

    user_id, report_session = store.get_report_context(session_id)
    assert user_id == "external-u1"
    assert [turn.role for turn in report_session.turns] == ["ai", "actor", "ai"]
    assert store.add_report(session_id, REPORT) is True
    assert store.add_report(session_id, REPORT) is False
    assert store.count_reports(user_id) == 1
    history = store.list_reports(user_id)
    assert history[0].session_id == session_id
    assert len(history[0].turns) == 3

    with store._session_factory() as db:
        assert (
            db.scalar(select(func.count(Summary.id))),
            db.scalar(select(func.count(Anomaly.id))),
        ) == immutable_counts
