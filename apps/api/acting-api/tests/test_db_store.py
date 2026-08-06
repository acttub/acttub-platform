from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import hashlib
import os
from pathlib import Path
from threading import Barrier, local
from uuid import UUID, uuid4

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import event, func, inspect, select, text, update
from sqlalchemy.engine import make_url

from acting_agent.schema import CoachSession, CoachTurn
from acting_api.auth.jwt import JwtService
from acting_api.db.engine import create_db_engine, normalize_database_url
from acting_api.db.models import (
    Anomaly,
    CoachSession as DbCoachSession,
    OperationKind,
    OperationStatus,
    PracticeSession,
    PracticeStatus,
    RefreshToken,
    SessionStatus,
    Summary,
    UploadStatus,
)
from acting_api.db.store import LeaseOwnershipError, PostgresStore
from acting_api.security import hash_token
from api_test_support import REPORT, SUBTEXT, SUMMARY

pytestmark = pytest.mark.db

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
    "external_operations",
    "community_categories",
    "community_posts",
    "community_comments",
    "community_post_likes",
    "community_reports",
    "community_blocks",
    "community_anonymous_aliases",
}


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
def postgres_store(postgres_schema):
    scoped_url, alembic_config = postgres_schema
    command.upgrade(alembic_config, "head")

    store = PostgresStore.from_url(scoped_url)
    try:
        yield store
    finally:
        store.close()


def test_empty_schema_upgrade_creates_exact_v2_schema(postgres_store):
    store = postgres_store
    table_names = set(inspect(store._engine).get_table_names()) - {"alembic_version"}
    assert table_names == EXPECTED_TABLES
    with store._engine.connect() as connection:
        enum_names = set(
            connection.scalars(
                text(
                    "SELECT typname FROM pg_type "
                    "WHERE typname LIKE '%_t' AND typnamespace = "
                    "(SELECT oid FROM pg_namespace WHERE nspname = current_schema())"
                )
            )
        )
    assert {
        "user_status_t",
        "identity_provider_t",
        "consent_type_t",
        "consent_action_t",
        "upload_status_t",
        "practice_status_t",
        "intent_impact_t",
        "severity_t",
        "session_status_t",
        "close_reason_t",
        "turn_role_t",
        "operation_kind_t",
        "operation_status_t",
    } <= enum_names


def test_development_identity_provider_is_persisted_after_migration(postgres_store):
    user = postgres_store.create_user(email="development-actor@example.com")

    identity = postgres_store.link_user_identity(
        user_id=user.id,
        provider="development",
        provider_uid="local-development-actor",
    )

    assert identity.user_id == user.id
    assert (
        postgres_store.get_user_by_identity(
            "development", "local-development-actor"
        ).id
        == user.id
    )


def test_0003_renames_existing_dev_identity_to_development(postgres_schema):
    scoped_url, alembic_config = postgres_schema
    command.upgrade(alembic_config, "0002_add_dev_identity_provider")
    engine = create_db_engine(scoped_url)
    try:
        with engine.begin() as connection:
            user_id = connection.scalar(
                text(
                    "INSERT INTO users (email) VALUES (:email) "
                    "RETURNING id"
                ),
                {"email": "migration-development-actor@example.com"},
            )
            connection.execute(
                text(
                    "INSERT INTO user_identities "
                    "(user_id, provider, provider_uid) "
                    "VALUES (:user_id, 'dev', :provider_uid)"
                ),
                {"user_id": user_id, "provider_uid": "migration-local-user"},
            )

        command.upgrade(alembic_config, "0003_rename_dev_provider")

        with engine.connect() as connection:
            provider = connection.scalar(
                text(
                    "SELECT provider::text FROM user_identities "
                    "WHERE provider_uid = :provider_uid"
                ),
                {"provider_uid": "migration-local-user"},
            )
        assert provider == "development"
    finally:
        engine.dispose()


def test_account_consent_upload_and_practice_lifecycle(postgres_store):
    store = postgres_store
    now = datetime.now(timezone.utc)
    user = store.create_user(email="actor@example.com")
    assert store.get_user_by_email("ACTOR@example.com").id == user.id
    identity = store.link_user_identity(
        user_id=user.id, provider="google", provider_uid="google-actor-1"
    )
    assert identity.user_id == user.id
    assert store.get_user_by_identity("google", "google-actor-1").id == user.id

    old_terms = store.publish_consent_document(
        type="terms",
        version="1",
        title="Terms 1",
        body="old",
        required=True,
        published_at=now - timedelta(days=1),
    )
    new_terms = store.publish_consent_document(
        type="terms",
        version="2",
        title="Terms 2",
        body="new",
        required=True,
        published_at=now,
    )
    privacy = store.publish_consent_document(
        type="privacy",
        version="1",
        title="Privacy",
        body="privacy",
        required=True,
        published_at=now,
    )
    latest = {
        document.type.value: document.version
        for document in store.list_latest_consent_documents()
    }
    assert latest == {"privacy": "1", "terms": "2"}
    assert store.get_consent_document(new_terms.id).version == "2"
    assert store.get_consent_document_by_type_version("terms", "2").id == new_terms.id
    assert store.has_pending_required_consents(user.id) is True
    all_documents = store.list_consent_documents()
    assert all_documents[0].id == old_terms.id
    assert {(document.type.value, document.version) for document in all_documents} == {
        ("terms", "1"),
        ("terms", "2"),
        ("privacy", "1"),
    }

    store.record_user_consent(
        user_id=user.id,
        document_id=old_terms.id,
        action="granted",
        occurred_at=now - timedelta(minutes=1),
    )
    store.record_user_consent(
        user_id=user.id,
        document_id=old_terms.id,
        action="revoked",
        occurred_at=now,
    )
    store.record_user_consent(
        user_id=user.id,
        document_id=new_terms.id,
        action="granted",
        occurred_at=now,
    )
    store.record_user_consent(
        user_id=user.id,
        document_id=privacy.id,
        action="granted",
        occurred_at=now,
    )
    current = {
        event.document_id: event.action.value
        for event in store.get_current_user_consents(user.id)
    }
    assert current == {
        old_terms.id: "revoked",
        new_terms.id: "granted",
        privacy.id: "granted",
    }
    assert store.has_pending_required_consents(user.id) is False

    expired = store.create_upload_intent(
        user_id=user.id,
        storage_provider="s3",
        object_key=f"users/{user.id}/expired.mp4",
        mime_type="video/mp4",
        size_bytes=12,
        expires_at=now - timedelta(seconds=1),
    )
    assert store.sweep_expired_upload_intents(now=now) == [expired.object_key]
    with store._session_factory() as db:
        assert db.get(type(expired), expired.id).status == UploadStatus.EXPIRED

    session = _create_practice(store, user.id, "lifecycle", now)
    assert store.get_practice_session(user_id=user.id, session_id=session.id).id == session.id
    assert store.transition_practice_session_status(
        user_id=user.id, session_id=session.id, status="analyzing", now=now
    )
    assert store.transition_practice_session_status(
        user_id=user.id, session_id=session.id, status="failed", now=now
    )
    assert store.transition_practice_session_status(
        user_id=user.id, session_id=session.id, status="analyzing", now=now
    )
    assert [item.id for item in store.list_practice_sessions(user.id)] == [session.id]
    assert store.hide_practice_session(user_id=user.id, session_id=session.id, now=now)
    assert store.get_practice_session(user_id=user.id, session_id=session.id) is None
    assert store.list_practice_sessions(user.id) == []


def test_refresh_rotation_and_rotated_token_reuse_revokes_all(postgres_store):
    store = postgres_store
    now = datetime.now(timezone.utc)
    user = store.create_user()
    original_hash = _hash("original")
    replacement_hash = _hash("replacement")
    spare_hash = _hash("spare-device")
    original = store.issue_refresh_token(
        user_id=user.id,
        token_hash=original_hash,
        expires_at=now + timedelta(days=14),
        device_info="iphone",
        issued_at=now,
    )
    store.issue_refresh_token(
        user_id=user.id,
        token_hash=spare_hash,
        expires_at=now + timedelta(days=14),
        device_info="ipad",
        issued_at=now,
    )

    rotation = store.rotate_refresh_token(
        token_hash=original_hash,
        new_token_hash=replacement_hash,
        expires_at=now + timedelta(days=14),
        now=now + timedelta(seconds=1),
    )
    assert rotation.reused_rotated_token is False
    assert rotation.token is not None
    assert rotation.token.user_id == user.id
    persisted_original = store.get_refresh_token(original_hash)
    assert persisted_original.replaced_by_id == rotation.token.id
    assert persisted_original.revoked_at is not None

    reuse = store.rotate_refresh_token(
        token_hash=original_hash,
        new_token_hash=_hash("attacker-replacement"),
        expires_at=now + timedelta(days=14),
        now=now + timedelta(seconds=2),
    )
    assert reuse.reused_rotated_token is True
    assert reuse.token is None
    with store._session_factory() as db:
        tokens = list(
            db.scalars(select(RefreshToken).where(RefreshToken.user_id == user.id))
        )
    assert {token.id for token in tokens} >= {original.id, rotation.token.id}
    assert all(token.revoked_at is not None for token in tokens)


def test_atomic_practice_creation_idempotency_detail_and_manual_retry(postgres_store):
    store = postgres_store
    now = datetime.now(timezone.utc)
    user = store.create_user()
    upload = store.create_upload_intent(
        user_id=user.id,
        storage_provider="s3",
        object_key=f"users/{user.id}/atomic.mp4",
        mime_type="video/mp4",
        size_bytes=12,
        expires_at=now + timedelta(minutes=30),
    )
    store.finalize_upload_intent(
        user_id=user.id,
        upload_intent_id=upload.id,
        etag='"atomic-etag"',
        now=now,
    )
    request_id = uuid4()
    fingerprint = _hash("atomic-create")
    created = store.create_practice_session_with_analysis_operation(
        user_id=user.id,
        upload_intent_id=upload.id,
        situation="situation",
        character_context="character",
        goal="goal",
        request_id=request_id,
        request_fingerprint=fingerprint,
    )
    assert created.created is True
    assert created.session.status == PracticeStatus.ANALYZING
    assert created.operation.status == OperationStatus.PENDING

    duplicate = store.create_practice_session_with_analysis_operation(
        user_id=user.id,
        upload_intent_id=upload.id,
        situation="situation",
        character_context="character",
        goal="goal",
        request_id=request_id,
        request_fingerprint=fingerprint,
    )
    assert duplicate.created is False
    assert duplicate.session.id == created.session.id
    assert duplicate.fingerprint_mismatch is False
    detail = store.get_practice_session_detail(
        user_id=user.id,
        session_id=created.session.id,
    )
    assert detail.upload.id == upload.id
    assert detail.operation.id == created.operation.id
    assert detail.summary is None

    assert store.transition_practice_session_status(
        user_id=user.id,
        session_id=created.session.id,
        status="failed",
        now=now,
    )
    retry = store.create_analysis_retry_operation(
        user_id=user.id,
        session_id=created.session.id,
        request_id=uuid4(),
        request_fingerprint=_hash("manual-retry"),
        now=now,
    )
    assert retry.created is True
    assert retry.session.status == PracticeStatus.ANALYZING
    assert retry.operation.id != created.operation.id


def test_concurrent_practice_creation_replays_the_winning_operation(postgres_store):
    store = postgres_store
    now = datetime.now(timezone.utc)
    user = store.create_user()
    upload = store.create_upload_intent(
        user_id=user.id,
        storage_provider="s3",
        object_key=f"users/{user.id}/concurrent-create.mp4",
        mime_type="video/mp4",
        size_bytes=12,
        expires_at=now + timedelta(minutes=30),
    )
    assert store.finalize_upload_intent(
        user_id=user.id,
        upload_intent_id=upload.id,
        etag='"create-etag"',
        now=now,
    )
    request_id = uuid4()
    barrier = Barrier(2)
    thread_state = local()

    def synchronize_old_prelock_select(
        conn, cursor, statement, parameters, context, executemany
    ):
        if "upload_intents" in statement and "FOR UPDATE" in statement:
            thread_state.lock_seen = True
        if (
            "FROM external_operations" in statement
            and not getattr(thread_state, "lock_seen", False)
        ):
            barrier.wait(timeout=5)

    event.listen(store._engine, "before_cursor_execute", synchronize_old_prelock_select)
    try:
        def create():
            return store.create_practice_session_with_analysis_operation(
                user_id=user.id,
                upload_intent_id=upload.id,
                situation="situation",
                character_context="character",
                goal="goal",
                request_id=request_id,
                request_fingerprint=_hash("concurrent-create"),
            )

        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(lambda _: create(), range(2)))
    finally:
        event.remove(
            store._engine, "before_cursor_execute", synchronize_old_prelock_select
        )

    assert all(result is not None for result in results)
    assert {result.session.id for result in results} == {results[0].session.id}
    assert {result.operation.id for result in results} == {results[0].operation.id}
    assert sorted(result.created for result in results) == [False, True]


def test_concurrent_analysis_retry_replays_the_winning_operation(postgres_store):
    store = postgres_store
    now = datetime.now(timezone.utc)
    user = store.create_user()
    practice = _create_practice(store, user.id, "concurrent-retry", now)
    assert store.transition_practice_session_status(
        user_id=user.id,
        session_id=practice.id,
        status=PracticeStatus.ANALYZING,
        now=now,
    )
    assert store.transition_practice_session_status(
        user_id=user.id,
        session_id=practice.id,
        status=PracticeStatus.FAILED,
        now=now,
    )
    request_id = uuid4()
    barrier = Barrier(2)
    thread_state = local()

    def synchronize_old_prelock_select(
        conn, cursor, statement, parameters, context, executemany
    ):
        if "practice_sessions" in statement and "FOR UPDATE" in statement:
            thread_state.lock_seen = True
        if (
            "FROM external_operations" in statement
            and not getattr(thread_state, "lock_seen", False)
        ):
            barrier.wait(timeout=5)

    event.listen(store._engine, "before_cursor_execute", synchronize_old_prelock_select)
    try:
        def retry():
            return store.create_analysis_retry_operation(
                user_id=user.id,
                session_id=practice.id,
                request_id=request_id,
                request_fingerprint=_hash("concurrent-retry"),
                now=now,
            )

        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(lambda _: retry(), range(2)))
    finally:
        event.remove(
            store._engine, "before_cursor_execute", synchronize_old_prelock_select
        )

    assert all(result is not None for result in results)
    assert {result.operation.id for result in results} == {results[0].operation.id}
    assert sorted(result.created for result in results) == [False, True]


def test_plain_refresh_jwt_is_never_stored(postgres_store):
    store = postgres_store
    now = datetime.now(timezone.utc).replace(microsecond=0)
    user = store.create_user()
    refresh = JwtService("db-test-secret").issue_refresh_token(user.id, now=now)
    stored = store.issue_refresh_token(
        user_id=user.id,
        token_hash=hash_token(refresh.value),
        expires_at=refresh.expires_at,
        issued_at=now,
    )
    assert stored.token_hash == hash_token(refresh.value)
    assert stored.token_hash != refresh.value
    assert store.get_refresh_token(hash_token(refresh.value)).id == stored.id


def test_owned_workflow_contexts_and_atomic_sync_operation_completion(postgres_store):
    store = postgres_store
    now = datetime.now(timezone.utc)
    user = store.create_user(email="workflow@example.com")
    other = store.create_user(email="other-workflow@example.com")
    practice = _create_practice(store, user.id, "workflow", now)
    summary_id = _complete_analysis(
        store,
        user.id,
        practice.id,
        now,
        transcripts=("첫 대사", "둘째 대사"),
    )
    owned_summary = store.get_owned_practice_session_context(
        user_id=user.id,
        practice_session_id=practice.id,
    )
    assert owned_summary.practice_session_id == practice.id
    assert owned_summary.summary_id == summary_id
    assert owned_summary.observation_pack.model_dump() == SUMMARY.model_dump()
    assert owned_summary.actor.goal == SUBTEXT.goal
    assert owned_summary.transcripts == ("첫 대사", "둘째 대사")
    assert (
        store.get_owned_practice_session_context(
            user_id=other.id, practice_session_id=practice.id
        )
        is None
    )

    start_lookup = store.get_or_create_external_operation(
        user_id=user.id,
        session_id=practice.id,
        request_id=uuid4(),
        kind="coach_start",
        request_fingerprint=_hash("coach-start"),
    )
    start_token = uuid4()
    store.claim_external_operation(
        operation_id=start_lookup.operation.id,
        lease_token=start_token,
        lease_duration=timedelta(minutes=10),
        now=now,
    )
    coach_session_id = uuid4()
    handoff_id = uuid4()
    handoff_json = {
        "handoff_type": "analysis",
        "blocked_point": "왜 지금 말하는지",
        "line_meaning": "상대를 붙잡는 말",
        "timing_reason": "상대가 돌아서는 순간",
        "target_effect": "상대가 멈추게 한다",
        "scene_evidence": ["상대가 돌아선다"],
        "actor_words": ["놓치면 끝이야"],
        "coach_summary": "돌아서는 상대를 붙잡는다",
        "uncertainties": [],
    }
    coach_session = CoachSession(
        session_id=str(coach_session_id),
        practice_session_id=str(practice.id),
        summary_id=str(summary_id),
        observation_pack=owned_summary.observation_pack,
        actor=owned_summary.actor,
        blockage_kind=owned_summary.actor.blockage_kind,
        sub_branch=owned_summary.sub_branch,
        blockage_detail=owned_summary.actor.blockage_detail,
        turns=[],
    )
    start_payload = {
        "session_id": str(coach_session_id),
        "message": None,
        "status": "continue",
        "handoff": None,
    }
    assert store.complete_coach_start_operation(
        operation_id=start_lookup.operation.id,
        lease_token=start_token,
        coach_session=coach_session,
        response_payload=start_payload,
        now=now,
    )
    owned_coach = store.get_owned_coach_session(
        user_id=user.id,
        coach_session_id=coach_session_id,
    )
    assert owned_coach.practice_session_id == practice.id
    assert owned_coach.session.transcripts == ["첫 대사", "둘째 대사"]
    assert owned_coach.session.turns == []
    assert store.get_owned_coach_session(
        user_id=other.id,
        coach_session_id=coach_session_id,
    ) is None

    reply_lookup = store.get_or_create_external_operation(
        user_id=user.id,
        session_id=practice.id,
        request_id=uuid4(),
        kind="coach_reply",
        request_fingerprint=_hash("coach-reply"),
    )
    reply_token = uuid4()
    store.claim_external_operation(
        operation_id=reply_lookup.operation.id,
        lease_token=reply_token,
        lease_duration=timedelta(minutes=10),
        now=now,
    )
    owned_coach.session.turns.extend(
        [
            CoachTurn(role="actor", text="지금 놓치면 끝이야"),
            CoachTurn(role="ai", text="상대를 붙잡으려는 말이야"),
        ]
    )
    reply_payload = {
        "session_id": str(coach_session_id),
        "message": "상대를 붙잡으려는 말이야",
        "status": "complete",
        "handoff": {
            "id": str(handoff_id),
            "branch_kind": "analysis",
        },
    }
    assert store.complete_coach_reply_operation(
        operation_id=reply_lookup.operation.id,
        lease_token=reply_token,
        coach_session=owned_coach.session,
        response_payload=reply_payload,
        handoff_id=handoff_id,
        branch_kind="analysis",
        handoff_json=handoff_json,
        now=now,
    )

    source = store.get_owned_report_source(
        user_id=user.id,
        coach_session_id=coach_session_id,
    )
    assert source.handoff_id == handoff_id
    assert source.confirmed is False
    source = store.confirm_latest_handoff(
        user_id=user.id,
        coach_session_id=coach_session_id,
        confirmed=True,
        rebuttal_text=None,
        now=now,
    )
    assert source.confirmed is True

    expression = store.create_practice_session(
        user_id=user.id,
        upload_intent_id=practice.upload_intent_id,
        situation="오디션 직전",
        character_context="불안한 배우",
        goal="상대가 멈추게 한다",
        blockage_kind="표현",
        sub_branch="화술",
        blockage_detail="대사처럼 들린다",
        status="analyzed",
    )
    expression_context = store.get_owned_practice_session_context(
        user_id=user.id,
        practice_session_id=expression.id,
    )
    assert expression_context.analysis_handoff == handoff_json

    report_lookup = store.get_or_create_external_operation(
        user_id=user.id,
        session_id=practice.id,
        request_id=uuid4(),
        kind="report",
        request_fingerprint=_hash("report"),
    )
    report_token = uuid4()
    store.claim_external_operation(
        operation_id=report_lookup.operation.id,
        lease_token=report_token,
        lease_duration=timedelta(minutes=10),
        now=now,
    )
    report_json = REPORT.model_copy(
        update={"source_handoff_id": str(handoff_id)}
    ).model_dump(mode="json")
    assert store.complete_practice_report_operation(
        operation_id=report_lookup.operation.id,
        lease_token=report_token,
        practice_session_id=practice.id,
        report_type="analysis",
        report_json=report_json,
        source_handoff_id=handoff_id,
        response_payload=report_json,
        now=now,
    )
    assert store.get_practice_report_for_handoff(handoff_id) == report_json
    history = store.list_report_summaries(user.id)
    assert history[0].practice_session_id == practice.id
    assert history[0].title == REPORT.title
    assert history[0].report_type == "analysis"
    assert store.has_report_for_practice_session(practice.id) is True
    assert store.has_report_for_practice_session(uuid4()) is False
    assert store.get_external_operation(
        user_id=user.id,
        request_id=report_lookup.operation.request_id,
    ).status == OperationStatus.SUCCEEDED


def test_completed_coach_reply_auto_confirms_closes_and_saves_report(postgres_store):
    store = postgres_store
    now = datetime.now(timezone.utc)
    user = store.create_user(email="auto-confirm@example.com")
    practice = _create_practice(store, user.id, "auto-confirm", now)
    summary_id = _complete_analysis(store, user.id, practice.id, now)
    context = store.get_owned_practice_session_context(
        user_id=user.id,
        practice_session_id=practice.id,
    )
    coach_session_id = uuid4()
    coach_session = CoachSession(
        session_id=str(coach_session_id),
        practice_session_id=str(practice.id),
        summary_id=str(summary_id),
        observation_pack=context.observation_pack,
        actor=context.actor,
        blockage_kind=context.actor.blockage_kind,
        sub_branch=context.sub_branch,
        blockage_detail=context.actor.blockage_detail,
        turns=[],
    )

    start_lookup = store.get_or_create_external_operation(
        user_id=user.id,
        session_id=practice.id,
        request_id=uuid4(),
        kind="coach_start",
        request_fingerprint=_hash("auto-confirm-start"),
    )
    start_token = uuid4()
    store.claim_external_operation(
        operation_id=start_lookup.operation.id,
        lease_token=start_token,
        lease_duration=timedelta(minutes=10),
        now=now,
    )
    store.complete_coach_start_operation(
        operation_id=start_lookup.operation.id,
        lease_token=start_token,
        coach_session=coach_session,
        response_payload={
            "session_id": str(coach_session_id),
            "message": "하나만 더 물을게.",
            "status": "continue",
            "handoff": None,
            "report": None,
        },
        now=now,
    )

    reply_lookup = store.get_or_create_external_operation(
        user_id=user.id,
        session_id=practice.id,
        request_id=uuid4(),
        kind="coach_reply",
        request_fingerprint=_hash("auto-confirm-reply"),
    )
    reply_token = uuid4()
    store.claim_external_operation(
        operation_id=reply_lookup.operation.id,
        lease_token=reply_token,
        lease_duration=timedelta(minutes=10),
        now=now,
    )
    handoff_id = uuid4()
    handoff_json = {
        "handoff_type": "analysis",
        "blocked_point": "왜 지금 말하는지",
        "line_meaning": "상대를 붙잡는 말",
        "timing_reason": "상대가 돌아서는 순간",
        "target_effect": "상대가 멈추게 한다",
        "scene_evidence": [],
        "actor_words": ["놓치면 끝이야"],
        "coach_summary": "상대를 붙잡는다",
        "uncertainties": [],
    }
    report_json = REPORT.model_copy(
        update={"source_handoff_id": str(handoff_id)}
    ).model_dump(mode="json")
    owned = store.get_owned_coach_session(
        user_id=user.id,
        coach_session_id=coach_session_id,
    )
    owned.session.turns.extend(
        [
            CoachTurn(role="actor", text="그만"),
            CoachTurn(role="ai", text="지금까지 찾은 말로 마무리할게."),
        ]
    )
    payload = {
        "session_id": str(coach_session_id),
        "message": "지금까지 찾은 말로 마무리할게.",
        "status": "complete",
        "handoff": {"id": str(handoff_id), "branch_kind": "analysis"},
        "report": report_json,
    }

    assert store.complete_coach_reply_operation(
        operation_id=reply_lookup.operation.id,
        lease_token=reply_token,
        coach_session=owned.session,
        response_payload=payload,
        handoff_id=handoff_id,
        branch_kind="analysis",
        handoff_json=handoff_json,
        confirmed=True,
        report_json=report_json,
        now=now,
    )

    source = store.get_owned_report_source(
        user_id=user.id,
        coach_session_id=coach_session_id,
    )
    assert source.confirmed is True
    assert store.get_owned_coach_session(
        user_id=user.id,
        coach_session_id=coach_session_id,
    ).session.status == "closed"
    assert store.get_practice_report_for_handoff(handoff_id) == report_json


def test_oldest_open_coach_session_lookup_and_restart_closure(postgres_store):
    store = postgres_store
    now = datetime.now(timezone.utc)
    user = store.create_user(email="coach-resume@example.com")
    other = store.create_user(email="coach-resume-other@example.com")
    practice = _create_practice(store, user.id, "coach-resume", now)
    summary_id = _complete_analysis(store, user.id, practice.id, now)
    context = store.get_owned_practice_session_context(
        user_id=user.id,
        practice_session_id=practice.id,
    )

    def persist_session(
        session_id: UUID,
        *,
        turns: list[CoachTurn],
        created_at: datetime,
        restart: bool = False,
    ) -> None:
        lookup = store.get_or_create_external_operation(
            user_id=user.id,
            session_id=practice.id,
            request_id=uuid4(),
            kind="coach_start",
            request_fingerprint=_hash(f"coach-resume-{session_id}"),
        )
        lease_token = uuid4()
        store.claim_external_operation(
            operation_id=lookup.operation.id,
            lease_token=lease_token,
            lease_duration=timedelta(minutes=10),
            now=created_at,
        )
        store.complete_coach_start_operation(
            operation_id=lookup.operation.id,
            lease_token=lease_token,
            coach_session=CoachSession(
                session_id=str(session_id),
                practice_session_id=str(practice.id),
                summary_id=str(summary_id),
                observation_pack=context.observation_pack,
                actor=context.actor,
                blockage_kind=context.actor.blockage_kind,
                sub_branch=context.sub_branch,
                blockage_detail=context.actor.blockage_detail,
                turns=turns,
            ),
            response_payload={
                "session_id": str(session_id),
                "message": turns[-1].text if turns else "",
                "status": "continue",
                "handoff": None,
                "report": None,
                "turns": [turn.model_dump(mode="json") for turn in turns],
            },
            restart=restart,
            now=created_at,
        )
        with store._session_factory.begin() as db:
            db.execute(
                update(DbCoachSession)
                .where(DbCoachSession.id == session_id)
                .values(created_at=created_at)
            )

    oldest_id = uuid4()
    oldest_turns = [
        CoachTurn(role="actor", text="첫 배우 말"),
        CoachTurn(role="ai", text="첫 질문"),
    ]
    persist_session(oldest_id, turns=oldest_turns, created_at=now)
    newer_id = uuid4()
    persist_session(
        newer_id,
        turns=[],
        created_at=now + timedelta(seconds=1),
    )

    resumed = store.get_oldest_open_coach_session(
        user_id=user.id,
        practice_session_id=practice.id,
    )
    assert resumed.session.session_id == str(oldest_id)
    assert resumed.session.turns == oldest_turns
    assert (
        store.get_oldest_open_coach_session(
            user_id=other.id,
            practice_session_id=practice.id,
        )
        is None
    )

    restarted_id = uuid4()
    persist_session(
        restarted_id,
        turns=[CoachTurn(role="ai", text="새 질문")],
        created_at=now + timedelta(seconds=2),
        restart=True,
    )

    assert (
        store.get_owned_coach_session(
            user_id=user.id, coach_session_id=oldest_id
        ).session.status
        == SessionStatus.CLOSED.value
    )
    assert (
        store.get_owned_coach_session(
            user_id=user.id, coach_session_id=newer_id
        ).session.status
        == SessionStatus.CLOSED.value
    )
    assert (
        store.get_oldest_open_coach_session(
            user_id=user.id,
            practice_session_id=practice.id,
        ).session.session_id
        == str(restarted_id)
    )


def test_external_operation_idempotency_lease_race_and_atomic_completion(
    postgres_store,
):
    store = postgres_store
    now = datetime.now(timezone.utc)
    user = store.create_user()
    practice = _create_practice(store, user.id, "lease", now)
    assert store.transition_practice_session_status(
        user_id=user.id, session_id=practice.id, status="analyzing", now=now
    )
    request_id = uuid4()
    fingerprint = _hash("same-request-body")

    first = store.get_or_create_external_operation(
        user_id=user.id,
        session_id=practice.id,
        request_id=request_id,
        kind="analyze",
        request_fingerprint=fingerprint,
    )
    same = store.get_or_create_external_operation(
        user_id=user.id,
        session_id=practice.id,
        request_id=request_id,
        kind="analyze",
        request_fingerprint=fingerprint,
    )
    mismatch = store.get_or_create_external_operation(
        user_id=user.id,
        session_id=practice.id,
        request_id=request_id,
        kind="analyze",
        request_fingerprint=_hash("different-request-body"),
    )
    assert first.created is True
    assert same.created is False
    assert same.operation.id == first.operation.id
    assert same.fingerprint_mismatch is False
    assert mismatch.created is False
    assert mismatch.operation.id == first.operation.id
    assert mismatch.fingerprint_mismatch is True

    barrier = Barrier(2)
    lease_tokens = [uuid4(), uuid4()]

    def claim(token: UUID):
        barrier.wait()
        return store.claim_external_operation(
            operation_id=first.operation.id,
            lease_token=token,
            lease_duration=timedelta(minutes=5),
            now=now,
        )

    with ThreadPoolExecutor(max_workers=2) as executor:
        claimed = list(executor.map(claim, lease_tokens))
    winners = [operation for operation in claimed if operation is not None]
    assert len(winners) == 1
    winner = winners[0]
    assert winner.attempt_count == 1

    with pytest.raises(LeaseOwnershipError):
        store.complete_analysis_operation(
            operation_id=first.operation.id,
            lease_token=uuid4(),
            observation_pack=SUMMARY,
            model="gemini-test",
            was_compressed=False,
            response_payload={"status": "analyzed"},
            now=now,
        )
    with store._session_factory() as db:
        assert db.scalar(select(func.count(Summary.id))) == 0

    summary_id = store.complete_analysis_operation(
        operation_id=first.operation.id,
        lease_token=winner.lease_token,
        observation_pack=SUMMARY,
        model="gemini-test",
        was_compressed=False,
        response_payload={"status": "analyzed"},
        now=now,
    )
    completed = store.get_external_operation(user_id=user.id, request_id=request_id)
    assert completed.status == OperationStatus.SUCCEEDED
    assert completed.response_payload["summary_id"] == str(summary_id)
    assert completed.lease_token is None
    with store._session_factory() as db:
        assert db.get(PracticeSession, practice.id).status == PracticeStatus.ANALYZED
        assert db.scalar(select(func.count(Summary.id))) == 1
        assert db.scalar(select(func.count(Anomaly.id))) == 0


def test_background_claim_skips_failed_and_transient_release_requeues(
    postgres_store,
):
    store = postgres_store
    now = datetime.now(timezone.utc)
    user = store.create_user()
    practice = _create_practice(store, user.id, "background-claim", now)
    assert store.transition_practice_session_status(
        user_id=user.id,
        session_id=practice.id,
        status=PracticeStatus.ANALYZING,
        now=now,
    )
    lookup = store.get_or_create_external_operation(
        user_id=user.id,
        session_id=practice.id,
        request_id=uuid4(),
        kind=OperationKind.ANALYZE,
        request_fingerprint=_hash("background-claim"),
    )

    first_token = uuid4()
    first = store.claim_next_external_operation(
        kind=OperationKind.ANALYZE,
        lease_token=first_token,
        lease_duration=timedelta(minutes=1),
        now=now,
    )
    assert first.id == lookup.operation.id
    assert store.release_external_operation(
        operation_id=first.id,
        lease_token=first_token,
        now=now + timedelta(seconds=1),
    )
    pending = store.get_external_operation(
        user_id=user.id, request_id=lookup.operation.request_id
    )
    assert pending.status == OperationStatus.PENDING

    second_token = uuid4()
    second = store.claim_next_external_operation(
        kind=OperationKind.ANALYZE,
        lease_token=second_token,
        lease_duration=timedelta(minutes=1),
        now=now + timedelta(seconds=2),
    )
    assert second.attempt_count == 2
    assert store.fail_external_operation(
        operation_id=second.id,
        lease_token=second_token,
        error_code="gemini_timeout",
        fail_session=True,
        now=now + timedelta(seconds=3),
    )
    assert store.claim_next_external_operation(
        kind=OperationKind.ANALYZE,
        lease_token=uuid4(),
        lease_duration=timedelta(minutes=1),
        now=now + timedelta(seconds=4),
    ) is None
    with store._session_factory() as db:
        assert db.get(PracticeSession, practice.id).status == PracticeStatus.FAILED


def test_external_operation_attempt_cap_and_sweep(postgres_store):
    store = postgres_store
    now = datetime.now(timezone.utc)
    user = store.create_user()
    practice = _create_practice(store, user.id, "attempts", now)
    assert store.transition_practice_session_status(
        user_id=user.id, session_id=practice.id, status="analyzing", now=now
    )
    lookup = store.get_or_create_external_operation(
        user_id=user.id,
        session_id=practice.id,
        request_id=uuid4(),
        kind=OperationKind.ANALYZE,
        request_fingerprint=_hash("attempt-body"),
    )

    for attempt in range(1, 4):
        token = uuid4()
        claimed = store.claim_external_operation(
            operation_id=lookup.operation.id,
            lease_token=token,
            lease_duration=timedelta(minutes=1),
            now=now + timedelta(minutes=attempt),
        )
        assert claimed.attempt_count == attempt
        assert store.fail_external_operation(
            operation_id=lookup.operation.id,
            lease_token=token,
            error_code="gemini_timeout",
            now=now + timedelta(minutes=attempt),
        )

    assert (
        store.claim_external_operation(
            operation_id=lookup.operation.id,
            lease_token=uuid4(),
            lease_duration=timedelta(minutes=1),
            now=now + timedelta(minutes=4),
        )
        is None
    )
    assert store.sweep_max_attempts_operations(now=now + timedelta(minutes=4)) == 1
    operation = store.get_external_operation(
        user_id=user.id, request_id=lookup.operation.request_id
    )
    assert operation.status == OperationStatus.FAILED
    assert operation.error_code == "max_attempts_exceeded"
    assert operation.attempt_count == 3
    with store._session_factory() as db:
        assert db.get(PracticeSession, practice.id).status == PracticeStatus.FAILED

    retry = store.create_analysis_retry_operation(
        user_id=user.id,
        session_id=practice.id,
        request_id=uuid4(),
        request_fingerprint=_hash("successful-retry"),
        now=now + timedelta(minutes=5),
    )
    retry_token = uuid4()
    assert store.claim_external_operation(
        operation_id=retry.operation.id,
        lease_token=retry_token,
        lease_duration=timedelta(minutes=1),
        now=now + timedelta(minutes=5),
    )
    store.complete_analysis_operation(
        operation_id=retry.operation.id,
        lease_token=retry_token,
        observation_pack=SUMMARY,
        model="gemini-test",
        was_compressed=False,
        response_payload={"status": "analyzed"},
        now=now + timedelta(minutes=5),
    )
    assert store.sweep_max_attempts_operations(now=now + timedelta(minutes=6)) == 0
    with store._session_factory() as db:
        assert db.get(PracticeSession, practice.id).status == PracticeStatus.ANALYZED


def _create_practice(
    store: PostgresStore, user_id: UUID, suffix: str, now: datetime
) -> PracticeSession:
    upload = store.create_upload_intent(
        user_id=user_id,
        storage_provider="s3",
        object_key=f"users/{user_id}/{suffix}.mp4",
        mime_type="video/mp4",
        size_bytes=1234,
        duration_ms=9000,
        expires_at=now + timedelta(hours=1),
    )
    assert store.finalize_upload_intent(
        user_id=user_id,
        upload_intent_id=upload.id,
        etag=f'"{suffix}-etag"',
        now=now,
    )
    session = store.create_practice_session(
        user_id=user_id,
        upload_intent_id=upload.id,
        situation=SUBTEXT.situation,
        character_context=SUBTEXT.character,
        goal=SUBTEXT.goal,
    )
    assert session is not None
    return session


def _complete_analysis(
    store: PostgresStore,
    user_id: UUID,
    session_id: UUID,
    now: datetime,
    transcripts=(),
) -> UUID:
    assert store.transition_practice_session_status(
        user_id=user_id,
        session_id=session_id,
        status="analyzing",
        now=now,
    )
    lookup = store.get_or_create_external_operation(
        user_id=user_id,
        session_id=session_id,
        request_id=uuid4(),
        kind=OperationKind.ANALYZE,
        request_fingerprint=_hash(f"seed-summary-{session_id}"),
    )
    lease_token = uuid4()
    assert store.claim_external_operation(
        operation_id=lookup.operation.id,
        lease_token=lease_token,
        lease_duration=timedelta(minutes=10),
        now=now,
    )
    return store.complete_analysis_operation(
        operation_id=lookup.operation.id,
        lease_token=lease_token,
        observation_pack=SUMMARY,
        model="gemini-test",
        was_compressed=False,
        response_payload={"status": "analyzed"},
        transcripts=transcripts,
        now=now,
    )


def _hash(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()
