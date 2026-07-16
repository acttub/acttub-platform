from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import UUID

import pytest
from sqlalchemy.dialects import postgresql
from sqlalchemy.exc import IntegrityError

from acting_agent.schema import CoachSession, CoachTurn
from acting_agent.store import SessionWriteConflict
from acting_api.db.models import (
    Anomaly,
    Base,
    CloseReason,
    CoachSession as DbCoachSession,
    CoachTurn as DbCoachTurn,
    Scene,
    SessionStatus,
    Summary,
    TurnRole,
)
from acting_api.db.store import PostgresStore
from api_test_support import AGENT_SUMMARY, SUBTEXT, SUMMARY_ID, SUMMARY as SUMMARY_DATA


def test_metadata_has_exact_initial_tables():
    assert set(Base.metadata.tables) == {
        "users",
        "api_keys",
        "scenes",
        "summaries",
        "anomalies",
        "coach_sessions",
        "coach_turns",
        "reports",
    }


def test_derived_user_columns_are_not_stored():
    assert "user_id" not in Base.metadata.tables["coach_sessions"].c
    assert "user_id" not in Base.metadata.tables["reports"].c


def test_required_reference_chain_is_non_nullable():
    tables = Base.metadata.tables
    assert tables["scenes"].c.user_id.nullable is False
    assert tables["summaries"].c.scene_id.nullable is False
    assert tables["coach_sessions"].c.summary_id.nullable is False
    assert tables["reports"].c.session_id.nullable is False
    assert tables["reports"].c.session_id.unique is True


def test_join_indexes_are_present():
    index_names = {
        index.name for table in Base.metadata.tables.values() for index in table.indexes
    }
    assert index_names == {
        "idx_turns_session",
        "idx_anomalies_summary",
        "idx_scenes_user",
        "idx_summaries_scene",
        "idx_sessions_summary",
    }


def test_only_report_session_unique_violation_is_treated_as_duplicate():
    duplicate = IntegrityError(
        "insert",
        {},
        SimpleNamespace(
            sqlstate="23505",
            diag=SimpleNamespace(constraint_name="reports_session_id_key"),
        ),
    )
    unrelated = IntegrityError(
        "insert",
        {},
        SimpleNamespace(
            sqlstate="23503",
            diag=SimpleNamespace(constraint_name="reports_session_id_fkey"),
        ),
    )

    assert PostgresStore._is_duplicate_report_error(duplicate) is True
    assert PostgresStore._is_duplicate_report_error(unrelated) is False


def test_closed_session_rejects_appended_turns_as_concurrent_write():
    session_id = UUID("22222222-2222-4222-8222-222222222222")
    summary_id = UUID(SUMMARY_ID)
    stored_turn = DbCoachTurn(
        session_id=session_id,
        turn_index=0,
        role=TurnRole.AI,
        text="코칭 종료",
        action="close",
        focus_timestamp="",
    )
    db_session = DbCoachSession(
        id=session_id,
        summary_id=summary_id,
        status=SessionStatus.CLOSED,
        close_reason=CloseReason.GAP_STATED,
    )
    db = MagicMock()
    db.scalar.return_value = db_session
    db.scalars.return_value = [stored_turn]
    session_factory = MagicMock()
    session_factory.begin.return_value.__enter__.return_value = db
    store = PostgresStore.__new__(PostgresStore)
    store._session_factory = session_factory
    hybrid_snapshot = CoachSession(
        session_id=str(session_id),
        summary_id=str(summary_id),
        summary=AGENT_SUMMARY,
        turns=[
            CoachTurn(role="ai", text="코칭 종료", action="close"),
            CoachTurn(role="actor", text="뒤늦은 답변"),
        ],
        status="closed",
        close_reason="gap_stated",
    )

    with pytest.raises(SessionWriteConflict, match="closed session"):
        store.save(hybrid_snapshot)

    db.add.assert_not_called()


def test_session_context_load_locks_session_row_before_turn_query():
    db = MagicMock()
    db.execute.return_value.one_or_none.return_value = None

    assert PostgresStore._load_session(
        db, UUID("22222222-2222-4222-8222-222222222222")
    ) is None

    statement = db.execute.call_args.args[0]
    sql = str(statement.compile(dialect=postgresql.dialect()))
    assert "FOR SHARE OF coach_sessions" in sql


def test_create_summary_flushes_each_parent_before_fk_children():
    events = []
    db = MagicMock()
    db.scalar.return_value = UUID("00000000-0000-4000-8000-000000000001")
    db.add.side_effect = lambda row: events.append(("add", type(row)))
    db.flush.side_effect = lambda: events.append(("flush", None))
    session_factory = MagicMock()
    session_factory.begin.return_value.__enter__.return_value = db
    store = PostgresStore.__new__(PostgresStore)
    store._session_factory = session_factory

    store.create_summary(
        user_id="external-u1",
        subtext=SUBTEXT,
        summary=SUMMARY_DATA,
        video_filename="scene.mp4",
        video_size_bytes=1234,
        was_compressed=False,
        model="gemini-test",
    )

    assert events == [
        ("add", Scene),
        ("flush", None),
        ("add", Summary),
        ("flush", None),
        ("add", Anomaly),
    ]
