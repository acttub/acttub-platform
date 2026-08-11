from unittest.mock import MagicMock
from uuid import UUID

import pytest
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from acting_agent.schema import CoachSession, CoachTurn
from acting_agent.store import SessionWriteConflict
from acting_api.db.models import (
    Base,
    CoachSession as DbCoachSession,
    CoachTurn as DbCoachTurn,
    ConsentAction,
    ConsentType,
    IdentityProvider,
    OperationKind,
    OperationStatus,
    PracticeStatus,
    SessionStatus,
    TurnRole,
    UploadStatus,
    UserStatus,
)
from acting_api.db.store import PostgresStore
from api_test_support import AGENT_SUMMARY, SUMMARY_ID


EXPECTED_TABLES = {
    "users",
    "user_identities",
    "refresh_tokens",
    "consent_documents",
    "user_consents",
    "upload_intents",
    "practice_sessions",
    "transcripts",
    "summaries",
    "anomalies",
    "coach_sessions",
    "coach_turns",
    "reports",
    "coaching_handoffs",
    "handoff_confirmations",
    "practice_reports",
    "actor_memory_entries",
    "external_operations",
    "community_categories",
    "community_posts",
    "community_comments",
    "community_post_likes",
    "community_reports",
    "community_blocks",
    "community_anonymous_aliases",
}


def test_metadata_has_exact_platform_v2_tables():
    assert set(Base.metadata.tables) == EXPECTED_TABLES
    assert "scenes" not in Base.metadata.tables
    assert "external_id" not in Base.metadata.tables["users"].c


def test_documented_enum_values_are_exact():
    assert [item.value for item in UserStatus] == [
        "active",
        "suspended",
        "deactivated",
    ]
    assert [item.value for item in IdentityProvider] == [
        "google",
        "kakao",
        "apple",
        "development",
    ]
    assert [item.value for item in ConsentType] == ["terms", "privacy", "ai_analysis"]
    assert [item.value for item in ConsentAction] == [
        "granted",
        "declined",
        "revoked",
    ]
    assert [item.value for item in UploadStatus] == ["pending", "finalized", "expired"]
    assert [item.value for item in PracticeStatus] == [
        "created",
        "analyzing",
        "analyzed",
        "failed",
    ]
    assert [item.value for item in OperationKind] == [
        "analyze",
        "coach_start",
        "coach_reply",
        "report",
        "memory_update",
    ]
    assert [item.value for item in OperationStatus] == [
        "pending",
        "running",
        "succeeded",
        "failed",
    ]


def test_required_reference_chain_and_v2_summary_columns():
    tables = Base.metadata.tables
    assert _fk_target(tables["summaries"].c.session_id) == "practice_sessions.id"
    assert _fk_target(tables["transcripts"].c.session_id) == "practice_sessions.id"
    assert next(iter(tables["transcripts"].c.session_id.foreign_keys)).ondelete == (
        "CASCADE"
    )
    assert _fk_target(tables["coach_sessions"].c.summary_id) == "summaries.id"
    assert _fk_target(tables["coach_sessions"].c.practice_session_id) == (
        "practice_sessions.id"
    )
    assert _fk_target(tables["reports"].c.session_id) == "coach_sessions.id"
    assert _fk_target(tables["practice_sessions"].c.user_id) == "users.id"
    assert "model" in tables["summaries"].c
    assert "was_compressed" in tables["summaries"].c
    assert "situation" in tables["practice_sessions"].c
    assert "character_context" in tables["practice_sessions"].c
    assert "subtext" in tables["practice_sessions"].c
    assert tables["practice_sessions"].c.subtext.nullable is True
    assert "goal" in tables["practice_sessions"].c
    assert {
        "observations_json",
        "uncertainties_json",
    } <= set(tables["summaries"].c.keys())
    for legacy in (
        "observation",
        "summary",
        "intent_alignment",
        "key_moment",
        "key_dimension",
    ):
        assert tables["summaries"].c[legacy].nullable is True
    assert "blockage_kind" in tables["practice_sessions"].c
    assert "sub_branch" in tables["practice_sessions"].c
    assert "blockage_detail" in tables["practice_sessions"].c
    assert "conversation_summary" in tables["coach_sessions"].c
    assert tables["coach_sessions"].c.conversation_summary.nullable is False
    assert "action" not in tables["coach_turns"].c
    assert "focus_timestamp" not in tables["coach_turns"].c
    assert _fk_target(tables["coaching_handoffs"].c.coach_session_id) == (
        "coach_sessions.id"
    )
    assert _fk_target(tables["practice_reports"].c.source_handoff_id) == (
        "coaching_handoffs.id"
    )
    assert tables["upload_intents"].c.etag.nullable is True
    assert "user_id" not in tables["coach_sessions"].c
    assert "user_id" not in tables["reports"].c


def test_every_time_column_is_timezone_aware():
    for table in Base.metadata.tables.values():
        for column in table.columns:
            if column.name.endswith("_at"):
                assert isinstance(column.type, sa.DateTime), (
                    table.name,
                    column.name,
                )
                assert column.type.timezone is True, (table.name, column.name)


def test_all_documented_unique_constraints_exist():
    expected = {
        "users": {("email",)},
        "user_identities": {("provider", "provider_uid")},
        "refresh_tokens": {("token_hash",)},
        "consent_documents": {("type", "version")},
        "upload_intents": {("object_key",)},
        "transcripts": {("session_id", "ord")},
        "summaries": {("session_id",)},
        "coach_turns": {("session_id", "turn_index")},
        "reports": {("session_id",)},
        "practice_reports": {("source_handoff_id",)},
        "external_operations": {("user_id", "request_id")},
    }
    for table_name, constraints in expected.items():
        actual = {
            tuple(column.name for column in constraint.columns)
            for constraint in Base.metadata.tables[table_name].constraints
            if isinstance(constraint, sa.UniqueConstraint)
        }
        assert constraints <= actual, table_name


def test_operational_indexes_cover_lists_sweeps_and_polling():
    index_names = {
        index.name for table in Base.metadata.tables.values() for index in table.indexes
    }
    assert {
        "idx_refresh_tokens_user_expires",
        "idx_consent_documents_latest",
        "idx_user_consents_current",
        "idx_upload_intents_expiry",
        "idx_practice_sessions_user_visible_created",
        "idx_practice_sessions_user",
        "idx_practice_sessions_status_updated",
        "idx_practice_sessions_upload_intent",
        "idx_anomalies_summary",
        "idx_sessions_summary",
        "idx_coach_sessions_practice",
        "idx_turns_session",
        "idx_external_operations_claimable",
        "idx_external_operations_session",
        "idx_external_operations_status_attempt_lease",
        "idx_coaching_handoffs_session_created",
        "idx_coaching_handoffs_practice_created",
        "idx_practice_reports_session_created",
    } <= index_names


def test_legacy_reports_table_remains_unchanged_for_read_only_history():
    columns = set(Base.metadata.tables["reports"].c.keys())
    assert columns == {
        "id",
        "session_id",
        "headline",
        "biggest_problem",
        "evidence",
        "self_discovery",
        "encouragement",
        "next_step",
        "comparison",
        "created_at",
    }


def test_closed_session_rejects_appended_turns_as_concurrent_write():
    session_id = UUID("22222222-2222-4222-8222-222222222222")
    practice_session_id = UUID("33333333-3333-4333-8333-333333333333")
    summary_id = UUID(SUMMARY_ID)
    stored_turn = DbCoachTurn(
        session_id=session_id,
        turn_index=0,
        role=TurnRole.AI,
        text="코칭 종료",
    )
    db_session = DbCoachSession(
        id=session_id,
        practice_session_id=practice_session_id,
        summary_id=summary_id,
        status=SessionStatus.CLOSED,
        close_reason=None,
    )
    db = MagicMock()
    db.scalar.return_value = db_session
    db.scalars.return_value = [stored_turn]
    hybrid_snapshot = CoachSession(
        session_id=str(session_id),
        practice_session_id=str(practice_session_id),
        summary_id=str(summary_id),
        observation_pack=AGENT_SUMMARY,
        actor={
            "situation": "상황",
            "character": "인물",
            "goal": "상대가 멈추게 한다",
            "blockage_kind": "분석",
            "blockage_detail": "상세",
            "duration_ms": 1000,
        },
        blockage_kind="분석",
        sub_branch="대사 분석",
        turns=[
            CoachTurn(role="ai", text="코칭 종료"),
            CoachTurn(role="actor", text="뒤늦은 답변"),
        ],
        status="closed",
    )

    with pytest.raises(SessionWriteConflict, match="closed session"):
        PostgresStore._save_coach_session(db, hybrid_snapshot)

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


def _fk_target(column: sa.Column) -> str:
    return next(iter(column.foreign_keys)).target_fullname
