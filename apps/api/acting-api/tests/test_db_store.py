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
    ActorMemoryField,
    Anomaly,
    CloseReason,
    CoachingHandoff,
    CoachSession as DbCoachSession,
    CoachTurn as DbCoachTurn,
    OperationKind,
    OperationStatus,
    PracticeReport as DbPracticeReport,
    PracticeSession,
    PracticeStatus,
    RefreshToken,
    SessionStatus,
    Summary,
    Transcript,
    TurnRole,
    UploadStatus,
    User,
    UserIdentity,
    UserStatus,
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


def test_create_user_with_identity_persists_signup_attribution(postgres_store):
    first_seen_at = datetime(2026, 7, 1, 12, 34, 56, tzinfo=timezone.utc)
    user, identity = postgres_store.create_user_with_identity(
        provider="google",
        provider_uid="attributed-google-user",
        email="attributed@example.com",
        signup_utm_source="stage",
        signup_utm_medium="subproject",
        signup_utm_campaign="summer",
        signup_utm_content="hero",
        signup_utm_term="acting",
        signup_referrer_host="search.example",
        signup_landing_path="/login",
        signup_first_seen_at=first_seen_at,
    )

    stored = postgres_store.get_user(user.id)
    assert identity.user_id == user.id
    assert stored.signup_utm_source == "stage"
    assert stored.signup_utm_medium == "subproject"
    assert stored.signup_utm_campaign == "summer"
    assert stored.signup_utm_content == "hero"
    assert stored.signup_utm_term == "acting"
    assert stored.signup_referrer_host == "search.example"
    assert stored.signup_landing_path == "/login"
    assert stored.signup_first_seen_at == first_seen_at


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


def test_deactivate_user_erases_identity_and_revokes_every_session(postgres_store):
    store = postgres_store
    now = datetime.now(timezone.utc)
    user = store.create_user(email="leaving@example.com")
    store.update_user_nickname(user.id, "떠나는배우")
    store.link_user_identity(
        user_id=user.id, provider="google", provider_uid="leaving-google"
    )
    for label in ("iphone", "ipad"):
        store.issue_refresh_token(
            user_id=user.id,
            token_hash=_hash(label),
            expires_at=now + timedelta(days=14),
            device_info=label,
            issued_at=now,
        )
    other = store.create_user(email="staying@example.com")
    store.issue_refresh_token(
        user_id=other.id,
        token_hash=_hash("other-device"),
        expires_at=now + timedelta(days=14),
        issued_at=now,
    )

    deactivated = store.deactivate_user(user.id, now=now)

    assert deactivated is not None
    assert deactivated.status is UserStatus.DEACTIVATED
    assert deactivated.deactivated_at == now
    # 행은 남는다 — 커뮤니티 글·연습 기록이 이 id 를 참조한다.
    assert store.get_user(user.id) is not None
    # 개인을 식별하는 것은 전부 파기된다.
    assert deactivated.email is None
    assert deactivated.nickname is None
    assert store.get_user_by_email("leaving@example.com") is None
    assert store.get_user_by_identity("google", "leaving-google") is None
    with store._session_factory() as db:
        assert (
            db.scalar(
                select(func.count())
                .select_from(UserIdentity)
                .where(UserIdentity.user_id == user.id)
            )
            == 0
        )

    with store._session_factory() as db:
        revoked = list(
            db.scalars(select(RefreshToken).where(RefreshToken.user_id == user.id))
        )
    assert len(revoked) == 2
    assert all(token.revoked_at == now for token in revoked)
    # 남의 세션·계정은 건드리지 않는다.
    assert store.get_refresh_token(_hash("other-device")).revoked_at is None
    assert store.get_user_by_email("staying@example.com").id == other.id

    # 끊어 둔 identity 자리에 같은 소셜 계정이 새 user 로 다시 들어올 수 있다.
    fresh, _ = store.create_user_with_identity(
        provider="google", provider_uid="leaving-google", email="leaving@example.com"
    )
    assert fresh.id != user.id
    assert store.get_user_by_identity("google", "leaving-google").id == fresh.id

    later = store.deactivate_user(user.id, now=now + timedelta(days=1))
    assert later.deactivated_at == now

    assert store.deactivate_user(uuid4()) is None


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


def test_admin_stats_windows_returning_users_and_team_exclusion(postgres_store):
    store = postgres_store
    now = datetime.now(timezone.utc)
    recent = now - timedelta(hours=1)  # 24시간·7일 창 모두 안
    mid = now - timedelta(days=3)  # 7일 창만 안
    old = now - timedelta(days=10)  # 두 창 모두 밖

    real_user = store.create_user(email="actor@example.com")
    team_user = store.create_user(email="Team@Acttub.com")  # 대소문자 매칭 확인
    with store._session_factory.begin() as db:
        db.execute(
            update(User)
            .where(User.id == real_user.id)
            .values(signup_utm_source="stage")
        )
        db.execute(
            update(User)
            .where(User.id == team_user.id)
            .values(signup_utm_source="voice")
        )

    def backdate_practice(practice_id: UUID, created_at: datetime, analyzed=False):
        values = {"created_at": created_at}
        if analyzed:
            values["status"] = PracticeStatus.ANALYZED
        with store._session_factory.begin() as db:
            db.execute(
                update(PracticeSession)
                .where(PracticeSession.id == practice_id)
                .values(**values)
            )

    def make_session(user_id: UUID, suffix: str, created_at: datetime, analyzed=False):
        practice = _create_practice(store, user_id, suffix, now)
        backdate_practice(practice.id, created_at, analyzed=analyzed)
        return practice

    def make_coach(
        practice_id: UUID,
        created_at: datetime,
        status: SessionStatus = SessionStatus.CLOSED,
        close_reason: CloseReason | None = None,
    ) -> UUID:
        coach_id = uuid4()
        with store._session_factory.begin() as db:
            db.add(
                DbCoachSession(
                    id=coach_id,
                    practice_session_id=practice_id,
                    status=status,
                    close_reason=close_reason,
                    created_at=created_at,
                    updated_at=created_at,
                )
            )
            db.add_all(
                [
                    DbCoachTurn(
                        session_id=coach_id,
                        turn_index=i,
                        role=TurnRole.ACTOR if i % 2 == 0 else TurnRole.AI,
                        text=f"turn-{i}",
                        created_at=created_at,
                    )
                    for i in range(2)
                ]
            )
        return coach_id

    def make_report(practice_id: UUID, coach_session_id: UUID) -> None:
        handoff_id = uuid4()
        with store._session_factory.begin() as db:
            db.add(
                CoachingHandoff(
                    id=handoff_id,
                    coach_session_id=coach_session_id,
                    practice_session_id=practice_id,
                    branch_kind="analysis",
                    handoff_json={},
                )
            )
            db.add(
                DbPracticeReport(
                    id=uuid4(),
                    practice_session_id=practice_id,
                    report_type="analysis",
                    report_json={},
                    source_handoff_id=handoff_id,
                )
            )

    # 실사용자: 세션 3개(최근/중간/오래전) — returning_3x 에 잡혀야 한다.
    real_recent = make_session(real_user.id, "real-recent", recent, analyzed=True)
    real_mid = make_session(real_user.id, "real-mid", mid)
    make_session(real_user.id, "real-old", old)
    real_coach_recent = make_coach(real_recent.id, recent)
    make_coach(real_mid.id, mid)
    make_report(real_recent.id, real_coach_recent)

    # 팀 계정: 세션 2개, 전부 최근 — raw 카운트엔 잡히지만 _real 에선 통째로 빠져야 한다.
    team_recent_1 = make_session(team_user.id, "team-recent-1", recent, analyzed=True)
    team_recent_2 = make_session(team_user.id, "team-recent-2", recent)
    team_coach_recent = make_coach(team_recent_1.id, recent)
    make_report(team_recent_1.id, team_coach_recent)

    stats = store.admin_stats(exclude_emails=("team@acttub.com",))

    expected = {
        "users_total": 2,
        "users_total_real": 1,
        "users_last_7d": 2,
        "users_last_7d_real": 1,
        "users_last_24h": 2,
        "users_last_24h_real": 1,
        "practice_sessions_total": 5,
        "practice_sessions_total_real": 3,
        "practice_sessions_last_7d": 4,
        "practice_sessions_last_7d_real": 2,
        "practice_sessions_last_24h": 3,
        "practice_sessions_last_24h_real": 1,
        "uploads_finalized_total": 5,
        "uploads_finalized_total_real": 3,
        "analyses_completed_total": 2,
        "analyses_completed_total_real": 1,
        "coach_sessions_total": 3,
        "coach_sessions_total_real": 2,
        "coach_sessions_last_7d": 3,
        "coach_sessions_last_7d_real": 2,
        "coach_sessions_last_24h": 2,
        "coach_sessions_last_24h_real": 1,
        "coach_turns_total": 6,
        "coach_turns_total_real": 4,
        "coach_turns_last_7d": 6,
        "coach_turns_last_7d_real": 4,
        "coach_turns_last_24h": 4,
        "coach_turns_last_24h_real": 2,
        "reports_total": 2,
        "reports_total_real": 1,
        "active_users_last_7d": 2,
        "active_users_last_7d_real": 1,
        "users_with_session": 2,
        "users_with_session_real": 1,
        "returning_2x": 2,
        "returning_2x_real": 1,
        "returning_3x": 1,
        "returning_3x_real": 1,
    }
    for key, value in expected.items():
        assert stats[key] == value, key
    assert stats["last_session_at"] == recent
    assert stats["last_signup_at"] is not None

    # exclude_emails 가 비면 _real 은 추가 쿼리 없이 포함 값과 같아진다.
    stats_no_exclude = store.admin_stats()
    for key in expected:
        if key.endswith("_real"):
            assert stats_no_exclude[key] == stats_no_exclude[key[: -len("_real")]]

    # ---- 2차: 어제(KST)·퍼널·종료 사유 분포·gap_stated 창·관찰·DB 크기.
    # 경계는 admin_stats 와 같은 식으로 직접 계산한다 — 테스트가 언제 도는지와
    # 무관하게 맞아야 하고, 그래야 롤링 24시간과 달력상 어제가 실제로 다른 값이 된다.
    stats_before = store.admin_stats(exclude_emails=("team@acttub.com",))

    now_kst = now + timedelta(hours=9)
    today_kst_midnight = now_kst.replace(hour=0, minute=0, second=0, microsecond=0)
    yesterday_end_utc = today_kst_midnight - timedelta(hours=9)  # 오늘 KST 00:00
    yesterday_start_utc = yesterday_end_utc - timedelta(days=1)  # 어제 KST 00:00
    since_24h = now - timedelta(hours=24)

    today_marker = yesterday_end_utc + timedelta(minutes=5)  # 오늘 KST 00:05
    yesterday_marker = yesterday_start_utc + timedelta(seconds=1)  # 어제 KST 맨 처음 근처
    day_before_marker = yesterday_start_utc - timedelta(hours=1)  # 그저께

    # yesterday_marker 는 항상 어제 KST 창 안이지만, now 가 자정을 막 지난 극단적인
    # 순간이 아닌 한 롤링 24시간(now-24h) 보다도 앞이다 — 그게 이번에 확인할 차이다.
    assert yesterday_marker < since_24h

    extra_user = store.create_user(email="extra@example.com")
    with store._session_factory.begin() as db:
        db.execute(
            update(User).where(User.id == extra_user.id).values(created_at=yesterday_marker)
        )

    today_session = make_session(extra_user.id, "extra-today", today_marker)
    yesterday_session = make_session(extra_user.id, "extra-yesterday", yesterday_marker)
    make_session(extra_user.id, "extra-day-before", day_before_marker)

    make_coach(
        yesterday_session.id,
        yesterday_marker,
        status=SessionStatus.CLOSED,
        close_reason=CloseReason.GAP_STATED,
    )
    make_coach(
        today_session.id,
        today_marker,
        status=SessionStatus.OPEN,
        close_reason=None,
    )

    stats_after = store.admin_stats(exclude_emails=("team@acttub.com",))

    # 어제(KST) vs 롤링 24시간 — 핵심 확인.
    assert stats_after["users_yesterday"] - stats_before["users_yesterday"] == 1
    assert stats_after["users_yesterday_real"] - stats_before["users_yesterday_real"] == 1
    assert (
        stats_after["active_users_yesterday"]
        - stats_before["active_users_yesterday"]
        == 1
    )
    assert (
        stats_after["active_users_yesterday_real"]
        - stats_before["active_users_yesterday_real"]
        == 1
    )
    # 어제 가입·활동은 last_24h 에는 안 잡힌다 — 다른 창이라는 증거.
    assert stats_after["users_last_24h"] == stats_before["users_last_24h"]
    assert (
        stats_after["practice_sessions_last_24h"]
        == stats_before["practice_sessions_last_24h"] + 1  # today_marker 세션만 잡힘
    )

    # 퍼널 — extra_user(비팀) 는 가입·업로드·연습세션·코치대화·마무리까지 가고
    # 분석 완료는 안 갔다. team_user 는 real 에서 전부 빠진다.
    funnel = {row["step"]: row for row in stats_after["funnel_steps"]}
    assert [row["step"] for row in stats_after["funnel_steps"]] == [
        "가입",
        "업로드 확정",
        "연습 세션",
        "분석 완료",
        "코치 대화",
        "대화 마무리",
        "놓친 생각 말함",
    ]
    assert funnel["가입"]["users"] == 3  # real, team, extra
    assert funnel["가입"]["users_real"] == 2  # team 제외
    assert funnel["업로드 확정"]["users"] == 3
    assert funnel["업로드 확정"]["users_real"] == 2
    assert funnel["연습 세션"]["users"] == 3
    assert funnel["연습 세션"]["users_real"] == 2
    assert funnel["분석 완료"]["users"] == 2  # real, team 만 (extra 는 분석 안 함)
    assert funnel["분석 완료"]["users_real"] == 1
    assert funnel["코치 대화"]["users"] == 3
    assert funnel["코치 대화"]["users_real"] == 2
    assert funnel["대화 마무리"]["users"] == 3  # extra 도 어제 세션이 closed
    assert funnel["대화 마무리"]["users_real"] == 2
    assert funnel["놓친 생각 말함"]["users"] == 1  # extra 뿐
    assert funnel["놓친 생각 말함"]["users_real"] == 1

    signup_sources = {
        row["source"]: (row["users"], row["users_real"])
        for row in stats_after["signup_sources"]
    }
    assert signup_sources == {
        "(직접/미상)": (1, 1),
        "stage": (1, 1),
        "voice": (1, 0),
    }

    # 종료 사유 분포 — count 내림차순, 동률 구간 순서는 안 따진다.
    close_reasons = {
        row["reason"]: (row["count"], row["count_real"])
        for row in stats_after["close_reasons"]
    }
    assert close_reasons["사유 없음"] == (3, 2)  # 1차에서 만든 코치 세션들
    assert close_reasons["gap_stated"] == (1, 1)
    assert close_reasons["진행 중"] == (1, 1)
    counts_desc = [row["count"] for row in stats_after["close_reasons"]]
    assert counts_desc == sorted(counts_desc, reverse=True)

    # gap_stated 창 — 어제 세션은 all·7d 에는 잡히고 24h 에는 안 잡힌다.
    assert stats_after["gap_stated_all"] - stats_before["gap_stated_all"] == 1
    assert stats_after["gap_stated_all_real"] - stats_before["gap_stated_all_real"] == 1
    assert stats_after["gap_stated_7d"] - stats_before["gap_stated_7d"] == 1
    assert stats_after["gap_stated_7d_real"] - stats_before["gap_stated_7d_real"] == 1
    assert stats_after["gap_stated_24h"] == stats_before["gap_stated_24h"]
    assert stats_after["gap_stated_24h_real"] == stats_before["gap_stated_24h_real"]

    # 관찰 — 이 테스트는 summary/anomaly 를 안 만들었으니 0 이어야 한다.
    assert stats_after["observations_total"] == 0
    assert stats_after["observations_per_summary"] == 0.0

    # DB 크기 — 실제 Postgres 라 문자열이 나와야 한다.
    assert isinstance(stats_after["db_size"], str)
    assert stats_after["db_size"]


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


def _memory_insert(store, user_id, field, value, written_by):
    """기억 한 칸을 직접 넣는다. 저장 계층이 아직 없어 SQL 로 제약만 검증한다."""
    with store._engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO actor_memory_entries (user_id, field, value, written_by)"
                " VALUES (:u, :f, :v, :w)"
            ),
            {"u": user_id, "f": field, "v": value, "w": written_by},
        )


def test_actor_memory_keeps_one_row_per_field(postgres_store):
    store = postgres_store
    user = store.create_user(email="memory-actor@example.com")
    _memory_insert(store, user.id, "goal", "입시 준비", "agent")

    # 같은 칸을 두 번 넣을 수 없다. 갱신은 덮어쓰기여야 한다.
    with pytest.raises(Exception) as excinfo:
        _memory_insert(store, user.id, "goal", "취미", "agent")
    assert "uq_actor_memory_user_field" in str(excinfo.value)


def test_actor_memory_refuses_agent_written_demographics(postgres_store):
    """성별·나이를 에이전트가 못 넣는다 -- 영상에서 추론해 넣는 경로를 DB가 막는다."""
    store = postgres_store
    user = store.create_user(email="memory-demo@example.com")

    for field in ("gender", "age"):
        with pytest.raises(Exception) as excinfo:
            _memory_insert(store, user.id, field, "무언가", "agent")
        assert "ck_actor_memory_demographics_actor_only" in str(excinfo.value)

    # 배우가 직접 쓰는 건 된다.
    _memory_insert(store, user.id, "gender", "여성", "actor")
    _memory_insert(store, user.id, "age", "22", "actor")


def test_actor_memory_refuses_blank_and_oversized_values(postgres_store):
    store = postgres_store
    user = store.create_user(email="memory-bounds@example.com")

    # 빈 칸은 값이 아니라 행이 없는 것으로 표현한다.
    with pytest.raises(Exception) as excinfo:
        _memory_insert(store, user.id, "goal", "   ", "agent")
    assert "ck_actor_memory_value_not_blank" in str(excinfo.value)

    # 한 칸이 길어지면 프롬프트에서 대화 맥락을 밀어낸다.
    with pytest.raises(Exception) as excinfo:
        _memory_insert(store, user.id, "goal", "가" * 1001, "agent")
    assert "ck_actor_memory_value_length" in str(excinfo.value)

    _memory_insert(store, user.id, "goal", "가" * 1000, "agent")


def test_agent_updates_its_own_fields_but_never_the_actors(postgres_store):
    """이 표의 핵심 규칙 -- 배우가 손댄 칸은 에이전트가 덮지 못한다."""
    store = postgres_store
    user = store.create_user(email="memory-authority@example.com")
    practice = _create_practice(store, user.id, "memory", datetime.now(timezone.utc))

    first = store.write_actor_memory_as_agent(
        user_id=user.id,
        field=ActorMemoryField.GOAL,
        value="입시 준비",
        source_practice_session_id=practice.id,
    )
    assert first.value == "입시 준비"
    assert first.written_by_actor is False

    # 에이전트끼리는 덮는다 -- 연습이 쌓이면 기억이 갱신되어야 한다.
    second = store.write_actor_memory_as_agent(
        user_id=user.id,
        field=ActorMemoryField.GOAL,
        value="입시 준비(수시)",
        source_practice_session_id=practice.id,
    )
    assert second.value == "입시 준비(수시)"

    # 배우가 고치면 이긴다.
    edited = store.write_actor_memory_as_actor(
        user_id=user.id, field=ActorMemoryField.GOAL, value="취미로 하는 중"
    )
    assert edited.value == "취미로 하는 중"
    assert edited.written_by_actor is True

    # 그 뒤로는 에이전트가 갱신을 시도해도 건너뛴다.
    skipped = store.write_actor_memory_as_agent(
        user_id=user.id,
        field=ActorMemoryField.GOAL,
        value="입시 준비(정시)",
        source_practice_session_id=practice.id,
    )
    assert skipped is None
    kept = {item.field: item for item in store.list_actor_memory(user.id)}
    assert kept["goal"].value == "취미로 하는 중"
    assert kept["goal"].written_by_actor is True


def test_agent_never_writes_gender_or_age(postgres_store):
    store = postgres_store
    user = store.create_user(email="memory-agent-demo@example.com")
    practice = _create_practice(store, user.id, "memory", datetime.now(timezone.utc))

    for field in (ActorMemoryField.GENDER, ActorMemoryField.AGE):
        assert (
            store.write_actor_memory_as_agent(
                user_id=user.id,
                field=field,
                value="추론한 값",
                source_practice_session_id=practice.id,
            )
            is None
        )
    assert store.list_actor_memory(user.id) == []

    store.write_actor_memory_as_actor(
        user_id=user.id, field=ActorMemoryField.GENDER, value="여성"
    )
    assert [item.field for item in store.list_actor_memory(user.id)] == ["gender"]


def test_actor_deletes_one_field_or_everything(postgres_store):
    store = postgres_store
    user = store.create_user(email="memory-delete@example.com")
    store.write_actor_memory_as_actor(
        user_id=user.id, field=ActorMemoryField.GENDER, value="여성"
    )
    store.write_actor_memory_as_actor(
        user_id=user.id, field=ActorMemoryField.AGE, value="22"
    )

    assert (
        store.delete_actor_memory(user_id=user.id, field=ActorMemoryField.AGE) == 1
    )
    assert [item.field for item in store.list_actor_memory(user.id)] == ["gender"]

    assert store.delete_actor_memory(user_id=user.id) == 1
    assert store.list_actor_memory(user.id) == []


def test_actor_memory_disappears_with_the_user(postgres_store):
    """탈퇴는 행을 지우지 않지만, 기억은 남기지 않는다."""
    store = postgres_store
    user = store.create_user(email="memory-cascade@example.com")
    _memory_insert(store, user.id, "goal", "입시 준비", "agent")

    with store._engine.begin() as connection:
        connection.execute(
            text("DELETE FROM users WHERE id = :u"), {"u": user.id}
        )
        left = connection.scalar(
            text(
                "SELECT count(*) FROM actor_memory_entries WHERE user_id = :u"
            ),
            {"u": user.id},
        )
    assert left == 0


def test_prior_context_carries_the_card_of_the_same_practice_when_reopened(
    postgres_store,
):
    """같은 연습을 다시 열면, 그때 만든 카드가 곧 "해보기로 한 것" 이다.

    이번 연습을 빼고 지난 연습만 보면, 배우가 방금 마친 연습을 다시 열었을 때
    코치가 정작 그 연습에서 정한 방향을 모른 채 시작한다.
    """
    store = postgres_store
    user = store.create_user()
    now = datetime.now(timezone.utc)
    practice = _create_practice(store, user.id, "reopen", now)

    coach_id = uuid4()
    handoff_id = uuid4()
    with store._session_factory.begin() as db:
        db.add(
            DbCoachSession(
                id=coach_id,
                practice_session_id=practice.id,
                status=SessionStatus.CLOSED,
                conversation_summary="지난번엔 호흡 이야기를 했다",
                close_reason=CloseReason.GAP_STATED,
            )
        )
        db.add(
            CoachingHandoff(
                id=handoff_id,
                coach_session_id=coach_id,
                practice_session_id=practice.id,
                branch_kind="analysis",
                handoff_json={},
            )
        )
        db.add(
            DbPracticeReport(
                id=uuid4(),
                practice_session_id=practice.id,
                report_type="analysis",
                report_json={
                    "report_type": "analysis",
                    "next_take": {
                        "direction": "한 박자 늦게 말해보기",
                        "tested": False,
                    },
                },
                source_handoff_id=handoff_id,
            )
        )

    context = store.get_prior_practice_context(
        user_id=user.id, practice_session_id=practice.id
    )

    assert context.earlier_conversation == "지난번엔 호흡 이야기를 했다"
    assert context.pending_takes == ("한 박자 늦게 말해보기",)


def test_memory_update_material_reads_the_actors_own_words(postgres_store):
    """기억 갱신 재료를 실제 데이터베이스에서 읽어 온다.

    이 함수는 워커만 부르고 워커 시험은 가짜 저장소를 쓴다. 그래서 실제 SQL 이
    한 번도 안 돌아 이름 오타(NameError)가 배포까지 갔던 적이 있다. 여기서 진짜로
    한 번 돌린다.

    코치가 한 말은 담지 않는다 — 코치가 제안한 표현이 배우 본인의 말로 굳으면
    기억이 배우가 아니라 코치를 기록하게 된다.
    """
    store = postgres_store
    user = store.create_user()
    now = datetime.now(timezone.utc)
    practice = _create_practice(store, user.id, "material", now)

    coach_id = uuid4()
    with store._session_factory.begin() as db:
        db.add(
            DbCoachSession(
                id=coach_id,
                practice_session_id=practice.id,
                status=SessionStatus.CLOSED,
                conversation_summary="",
                close_reason=CloseReason.GAP_STATED,
            )
        )
        db.add_all(
            [
                DbCoachTurn(
                    session_id=coach_id,
                    turn_index=0,
                    role=TurnRole.ACTOR,
                    text="차분하게 말하려고 했어요",
                ),
                DbCoachTurn(
                    session_id=coach_id,
                    turn_index=1,
                    role=TurnRole.AI,
                    text="코치가 한 말은 담기지 않아야 한다",
                ),
            ]
        )
        db.add(Transcript(session_id=practice.id, ord=0, text="나는 괜찮아."))

    material = store.get_memory_update_material(practice_session_id=practice.id)

    assert material is not None
    assert material.user_id == user.id
    assert material.actor_messages == ("차분하게 말하려고 했어요",)
    assert material.transcripts == ("나는 괜찮아.",)
    assert material.blockage_kind == practice.blockage_kind


def test_memory_update_material_is_none_for_a_hidden_practice(postgres_store):
    """배우가 지운 연습으로는 기억을 갱신하지 않는다."""
    store = postgres_store
    user = store.create_user()
    now = datetime.now(timezone.utc)
    practice = _create_practice(store, user.id, "hidden-material", now)
    with store._session_factory.begin() as db:
        db.execute(
            update(PracticeSession)
            .where(PracticeSession.id == practice.id)
            .values(hidden_at=now)
        )

    assert store.get_memory_update_material(practice_session_id=practice.id) is None
