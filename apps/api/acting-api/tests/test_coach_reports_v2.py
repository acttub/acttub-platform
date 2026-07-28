from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from acting_agent.config import Settings as AgentSettings
from acting_api.app import create_app
from acting_api.auth.jwt import JwtService
from acting_api.config import GatewaySettings
from acting_api.db.models import OperationStatus
from acting_report.config import Settings as ReportSettings
from acting_report.schema import ReportRecord
from acting_summary.config import Settings as SummarySettings
from api_test_support import (
    COACH_FOLLOWUP,
    COACH_QUESTION,
    REPORT,
    FakeClient,
    FakeModelResponse,
)
from platform_test_support import FakePlatformStore

JWT_SECRET = "stage-4-test-secret"


class FakePlaybackStorage:
    def __init__(self):
        self.calls = []

    def presign_playback(self, *, object_key, expires_in_sec):
        self.calls.append((object_key, expires_in_sec))
        return f"https://playback.example/{object_key}?ttl={expires_in_sec}"


def _application(*, responses=(), clock=None, storage=None):
    store = FakePlatformStore()
    fake_client = FakeClient(responses)
    kwargs = {"clock": clock} if clock is not None else {}
    app = create_app(
        client=fake_client,
        gateway_settings=GatewaySettings(
            database_url="postgresql+psycopg://unused/unused",
            jwt_secret=JWT_SECRET,
        ),
        summary_settings=SummarySettings(api_key="k", model="summary-model"),
        agent_settings=AgentSettings(api_key="k", model="coach-model"),
        report_settings=ReportSettings(api_key="k", model="report-model"),
        store=store,
        s3_storage=storage,
        **kwargs,
    )
    user = store.create_user()
    access = JwtService(JWT_SECRET).issue_access_token(user.id).value
    headers = {"Authorization": f"Bearer {access}"}
    return TestClient(app), store, fake_client, user, headers


def _create_report(client, store, user_id, headers):
    summary_id = store.seed_summary(user_id=user_id)
    started = client.post(
        "/v2/coach/start",
        json={"summary_id": str(summary_id)},
        headers=headers,
    )
    assert started.status_code == 200
    coach_session_id = started.json()["session_id"]
    closed = client.post(
        "/v2/coach/reply",
        json={"session_id": coach_session_id, "text": "그만할래"},
        headers=headers,
    )
    assert closed.status_code == 200
    created = client.post(
        "/v2/reports",
        json={"session_id": coach_session_id},
        headers=headers,
    )
    assert created.status_code == 200
    practice_session_id = store.summaries[summary_id].session_id
    return practice_session_id, coach_session_id, created


def _post(client, path, *, headers, request_id, body):
    return client.post(
        path,
        json=body,
        headers={**headers, "X-Request-Id": str(request_id)},
    )


def test_coach_start_and_reply_reuse_engines_and_cache_success_bytes():
    client, store, fake, user, headers = _application(
        responses=[
            FakeModelResponse(parsed=COACH_QUESTION),
            FakeModelResponse(parsed=COACH_FOLLOWUP),
        ]
    )
    summary_id = store.seed_summary(user_id=user.id)
    start_request_id = uuid4()
    started = _post(
        client,
        "/v2/coach/start",
        headers=headers,
        request_id=start_request_id,
        body={"summary_id": str(summary_id)},
    )
    assert started.status_code == 200
    assert started.json()["utterance"] == COACH_QUESTION.question
    UUID(started.json()["session_id"])
    start_duplicate = _post(
        client,
        "/v2/coach/start",
        headers=headers,
        request_id=start_request_id,
        body={"summary_id": str(summary_id)},
    )
    assert start_duplicate.content == started.content
    assert len(fake.models.calls) == 1

    reply_request_id = uuid4()
    reply_body = {
        "session_id": started.json()["session_id"],
        "text": "대사가 기억 안 났어요",
    }
    replied = _post(
        client,
        "/v2/coach/reply",
        headers=headers,
        request_id=reply_request_id,
        body=reply_body,
    )
    assert replied.status_code == 200
    assert replied.json()["utterance"] == COACH_FOLLOWUP.question
    reply_duplicate = _post(
        client,
        "/v2/coach/reply",
        headers=headers,
        request_id=reply_request_id,
        body=reply_body,
    )
    assert reply_duplicate.content == replied.content
    assert len(fake.models.calls) == 2


def test_coach_resources_are_hidden_from_other_users():
    client, store, _, owner, owner_headers = _application(
        responses=[FakeModelResponse(parsed=COACH_QUESTION)]
    )
    other = store.create_user()
    other_access = JwtService(JWT_SECRET).issue_access_token(other.id).value
    other_headers = {"Authorization": f"Bearer {other_access}"}
    summary_id = store.seed_summary(user_id=owner.id)
    denied_start = client.post(
        "/v2/coach/start",
        json={"summary_id": str(summary_id)},
        headers=other_headers,
    )
    assert denied_start.status_code == 404

    started = client.post(
        "/v2/coach/start",
        json={"summary_id": str(summary_id)},
        headers=owner_headers,
    )
    UUID(started.headers["X-Request-Id"])
    denied_reply = client.post(
        "/v2/coach/reply",
        json={"session_id": started.json()["session_id"], "text": "왜요?"},
        headers=other_headers,
    )
    assert denied_reply.status_code == 404
    denied_report = client.post(
        "/v2/reports",
        json={"session_id": started.json()["session_id"]},
        headers=other_headers,
    )
    assert denied_report.status_code == 404


def test_sync_idempotency_running_is_409_and_fingerprint_mismatch_is_422():
    client, store, _, user, headers = _application(
        responses=[FakeModelResponse(parsed=COACH_QUESTION)]
    )
    first_summary_id = store.seed_summary(user_id=user.id)
    second_summary_id = store.seed_summary(user_id=user.id)
    request_id = uuid4()
    first = _post(
        client,
        "/v2/coach/start",
        headers=headers,
        request_id=request_id,
        body={"summary_id": str(first_summary_id)},
    )
    assert first.status_code == 200
    operation = store.get_external_operation(user_id=user.id, request_id=request_id)
    operation.status = OperationStatus.RUNNING
    operation.response_payload = None
    operation.lease_token = uuid4()
    operation.lease_expires_at = operation.updated_at + timedelta(minutes=10)
    running = _post(
        client,
        "/v2/coach/start",
        headers=headers,
        request_id=request_id,
        body={"summary_id": str(first_summary_id)},
    )
    assert running.status_code == 409
    assert running.json() == {"detail": "request is still processing"}

    mismatch = _post(
        client,
        "/v2/coach/start",
        headers=headers,
        request_id=request_id,
        body={"summary_id": str(second_summary_id)},
    )
    assert mismatch.status_code == 422


def test_failed_sync_operation_is_reexecuted_with_same_request_id():
    invalid = FakeModelResponse(text="not-json")
    client, store, fake, user, headers = _application(responses=[invalid, invalid])
    summary_id = store.seed_summary(user_id=user.id)
    request_id = uuid4()
    failed = _post(
        client,
        "/v2/coach/start",
        headers=headers,
        request_id=request_id,
        body={"summary_id": str(summary_id)},
    )
    assert failed.status_code == 502
    operation = store.get_external_operation(user_id=user.id, request_id=request_id)
    assert operation.status == OperationStatus.FAILED

    fake.queue_response(FakeModelResponse(parsed=COACH_QUESTION))
    retried = _post(
        client,
        "/v2/coach/start",
        headers=headers,
        request_id=request_id,
        body={"summary_id": str(summary_id)},
    )
    assert retried.status_code == 200
    assert operation.status == OperationStatus.SUCCEEDED
    assert operation.attempt_count == 2


def test_reports_create_history_idempotency_and_conflicts():
    client, store, fake, user, headers = _application(
        responses=[
            FakeModelResponse(parsed=COACH_QUESTION),
            FakeModelResponse(parsed=REPORT),
            FakeModelResponse(parsed=COACH_QUESTION),
        ]
    )
    summary_id = store.seed_summary(user_id=user.id)
    started = client.post(
        "/v2/coach/start",
        json={"summary_id": str(summary_id)},
        headers=headers,
    )
    session_id = started.json()["session_id"]
    client.post(
        "/v2/coach/reply",
        json={"session_id": session_id, "text": "그만할래"},
        headers=headers,
    )
    report_request_id = uuid4()
    report_body = {"session_id": session_id}
    created = _post(
        client,
        "/v2/reports",
        headers=headers,
        request_id=report_request_id,
        body=report_body,
    )
    assert created.status_code == 200
    assert "user_id" not in created.json()
    assert created.json()["report"]["headline"] == REPORT.headline
    assert created.json()["report_count"] == 1
    duplicate = _post(
        client,
        "/v2/reports",
        headers=headers,
        request_id=report_request_id,
        body=report_body,
    )
    assert duplicate.content == created.content

    history = client.get("/v2/reports", headers=headers)
    assert history.status_code == 200
    assert history.json()["count"] == 1
    assert "user_id" not in history.json()
    record = history.json()["reports"][0]
    assert "turns" not in record
    assert record["practice_session_id"] == str(
        store.summaries[summary_id].session_id
    )
    assert len(fake.models.calls) == 2

    duplicate_new_key = _post(
        client,
        "/v2/reports",
        headers=headers,
        request_id=uuid4(),
        body=report_body,
    )
    assert duplicate_new_key.status_code == 409
    assert duplicate_new_key.json()["detail"] == "report already exists for session"

    open_summary_id = store.seed_summary(user_id=user.id)
    open_session = client.post(
        "/v2/coach/start",
        json={"summary_id": str(open_summary_id)},
        headers=headers,
    ).json()["session_id"]
    still_open = client.post(
        "/v2/reports",
        json={"session_id": open_session},
        headers=headers,
    )
    assert still_open.status_code == 409
    assert still_open.json()["detail"] == "session is still open"


def test_report_detail_returns_strict_shape_and_presigned_playback_url():
    storage = FakePlaybackStorage()
    client, store, _, user, headers = _application(
        responses=[
            FakeModelResponse(parsed=COACH_QUESTION),
            FakeModelResponse(parsed=REPORT),
        ],
        storage=storage,
    )
    practice_session_id, _, _ = _create_report(
        client, store, user.id, headers
    )
    practice = store.sessions[practice_session_id]
    object_key = f"users/{user.id}/report-detail.mp4"
    store.uploads[practice.upload_intent_id] = SimpleNamespace(object_key=object_key)

    response = client.get(
        f"/v2/reports/{practice_session_id}", headers=headers
    )

    assert response.status_code == 200
    payload = response.json()
    assert set(payload) == {
        "practice_session_id",
        "created_at",
        "report",
        "playback_url",
    }
    assert payload["practice_session_id"] == str(practice_session_id)
    assert payload["report"] == REPORT.model_dump(mode="json")
    assert payload["playback_url"] == (
        f"https://playback.example/{object_key}?ttl=900"
    )
    assert storage.calls == [(object_key, 900)]


def test_report_detail_returns_404_for_hidden_practice_session():
    storage = FakePlaybackStorage()
    client, store, _, user, headers = _application(
        responses=[
            FakeModelResponse(parsed=COACH_QUESTION),
            FakeModelResponse(parsed=REPORT),
        ],
        storage=storage,
    )
    practice_session_id, _, _ = _create_report(
        client, store, user.id, headers
    )
    assert store.hide_practice_session(
        user_id=user.id,
        session_id=practice_session_id,
    )

    response = client.get(
        f"/v2/reports/{practice_session_id}", headers=headers
    )

    assert response.status_code == 404
    assert response.json() == {"detail": "report_not_found"}
    assert storage.calls == []


def test_report_detail_returns_503_when_storage_is_not_configured():
    client, store, _, user, headers = _application(
        responses=[
            FakeModelResponse(parsed=COACH_QUESTION),
            FakeModelResponse(parsed=REPORT),
        ]
    )
    practice_session_id, _, _ = _create_report(
        client, store, user.id, headers
    )
    practice = store.sessions[practice_session_id]
    store.uploads[practice.upload_intent_id] = SimpleNamespace(
        object_key="users/test/storage-none.mp4"
    )

    response = client.get(
        f"/v2/reports/{practice_session_id}", headers=headers
    )

    assert response.status_code == 503
    assert response.json() == {"detail": "storage_not_configured"}


def test_report_detail_selects_latest_report_for_practice_session():
    storage = FakePlaybackStorage()
    client, store, _, user, headers = _application(
        responses=[
            FakeModelResponse(parsed=COACH_QUESTION),
            FakeModelResponse(parsed=REPORT),
        ],
        storage=storage,
    )
    practice_session_id, first_coach_session_id, _ = _create_report(
        client, store, user.id, headers
    )
    practice = store.sessions[practice_session_id]
    store.uploads[practice.upload_intent_id] = SimpleNamespace(
        object_key="users/test/latest-report.mp4"
    )
    first_created_at = datetime(2026, 7, 20, tzinfo=timezone.utc)
    latest_created_at = first_created_at + timedelta(days=1)
    store.reports[first_coach_session_id] = ReportRecord(
        created_at=first_created_at.isoformat(),
        session_id=first_coach_session_id,
        practice_session_id=str(practice_session_id),
        report=REPORT.model_copy(update={"headline": "이전 리포트"}),
    )
    latest_coach_session_id = str(uuid4())
    store.coach_sessions[latest_coach_session_id] = store.coach_sessions[
        first_coach_session_id
    ].model_copy(update={"session_id": latest_coach_session_id}, deep=True)
    store.reports[latest_coach_session_id] = ReportRecord(
        created_at=latest_created_at.isoformat(),
        session_id=latest_coach_session_id,
        practice_session_id=str(practice_session_id),
        report=REPORT.model_copy(update={"headline": "최신 리포트"}),
    )

    response = client.get(
        f"/v2/reports/{practice_session_id}", headers=headers
    )

    assert response.status_code == 200
    assert response.json()["report"]["headline"] == "최신 리포트"
    assert datetime.fromisoformat(
        response.json()["created_at"].replace("Z", "+00:00")
    ) == latest_created_at


def test_report_history_is_slim_and_excludes_hidden_reports_from_count():
    client, store, _, user, headers = _application(
        responses=[
            FakeModelResponse(parsed=COACH_QUESTION),
            FakeModelResponse(parsed=REPORT),
            FakeModelResponse(parsed=COACH_QUESTION),
            FakeModelResponse(parsed=REPORT),
        ]
    )
    hidden_practice_id, _, _ = _create_report(
        client, store, user.id, headers
    )
    assert store.hide_practice_session(
        user_id=user.id,
        session_id=hidden_practice_id,
    )

    visible_practice_id, _, created = _create_report(
        client, store, user.id, headers
    )
    history = client.get("/v2/reports", headers=headers)

    assert created.json()["report_count"] == 1
    assert history.status_code == 200
    assert history.json()["count"] == 1
    assert len(history.json()["reports"]) == 1
    record = history.json()["reports"][0]
    assert set(record) == {"practice_session_id", "headline", "created_at"}
    assert record["practice_session_id"] == str(visible_practice_id)
    assert record["headline"] == REPORT.headline
    full_records = store.list_reports(user.id)
    assert len(full_records) == 1
    assert full_records[0].practice_session_id == str(visible_practice_id)
    assert full_records[0].report == REPORT


def test_create_report_comparison_still_receives_full_previous_report_body():
    client, store, fake, user, headers = _application(
        responses=[
            FakeModelResponse(parsed=COACH_QUESTION),
            FakeModelResponse(parsed=REPORT),
            FakeModelResponse(parsed=COACH_QUESTION),
            FakeModelResponse(parsed=REPORT),
        ]
    )
    _create_report(client, store, user.id, headers)

    _, _, created = _create_report(client, store, user.id, headers)

    assert created.json()["report_count"] == 2
    comparison_prompt = fake.models.calls[-1][1][0]
    assert REPORT.biggest_problem.description in comparison_prompt
    assert REPORT.next_step in comparison_prompt


def test_practice_session_allows_restart_until_report_then_rejects_coaching_and_report():
    client, store, _, user, headers = _application(
        responses=[
            FakeModelResponse(parsed=COACH_QUESTION),
            FakeModelResponse(parsed=COACH_QUESTION),
            FakeModelResponse(parsed=REPORT),
        ]
    )
    summary_id = store.seed_summary(user_id=user.id)
    practice_session_id = store.summaries[summary_id].session_id

    first = client.post(
        "/v2/coach/start",
        json={"summary_id": str(summary_id)},
        headers=headers,
    )
    second = client.post(
        "/v2/coach/start",
        json={"summary_id": str(summary_id)},
        headers=headers,
    )
    assert first.status_code == 200
    assert second.status_code == 200

    for response in (first, second):
        closed = client.post(
            "/v2/coach/reply",
            json={"session_id": response.json()["session_id"], "text": "그만할래"},
            headers=headers,
        )
        assert closed.status_code == 200

    created = client.post(
        "/v2/reports",
        json={"session_id": first.json()["session_id"]},
        headers=headers,
    )
    assert created.status_code == 200

    duplicate = client.post(
        "/v2/reports",
        json={"session_id": second.json()["session_id"]},
        headers=headers,
    )
    assert duplicate.status_code == 409
    assert duplicate.json() == {"detail": "report already exists for session"}

    restart = client.post(
        "/v2/coach/start",
        json={"summary_id": str(summary_id)},
        headers=headers,
    )
    assert restart.status_code == 409
    assert restart.json() == {
        "detail": "report already exists for practice session"
    }
    assert store.has_report_for_practice_session(practice_session_id) is True


def test_coach_start_replay_returns_cached_success_after_report():
    client, store, _, user, headers = _application(
        responses=[
            FakeModelResponse(parsed=COACH_QUESTION),
            FakeModelResponse(parsed=REPORT),
        ]
    )
    summary_id = store.seed_summary(user_id=user.id)
    start_request_id = uuid4()
    started = _post(
        client,
        "/v2/coach/start",
        headers=headers,
        request_id=start_request_id,
        body={"summary_id": str(summary_id)},
    )
    assert started.status_code == 200
    closed = client.post(
        "/v2/coach/reply",
        json={"session_id": started.json()["session_id"], "text": "그만할래"},
        headers=headers,
    )
    assert closed.status_code == 200
    created = client.post(
        "/v2/reports",
        json={"session_id": started.json()["session_id"]},
        headers=headers,
    )
    assert created.status_code == 200

    replayed = _post(
        client,
        "/v2/coach/start",
        headers=headers,
        request_id=start_request_id,
        body={"summary_id": str(summary_id)},
    )
    assert replayed.status_code == 200
    assert replayed.content == started.content


def test_report_history_strictly_rejects_invalid_runtime_record():
    client, store, _, user, headers = _application()

    class InvalidReportRecord:
        created_at = datetime(2026, 7, 21, tzinfo=timezone.utc)
        practice_session_id = ""
        headline = REPORT.headline

    store.list_report_summaries = lambda _user_id: [InvalidReportRecord()]

    with pytest.raises(ValidationError):
        client.get("/v2/reports", headers=headers)


def test_report_preparation_exception_marks_claimed_operation_failed():
    client, store, _, user, headers = _application(
        responses=[FakeModelResponse(parsed=COACH_QUESTION)]
    )
    summary_id = store.seed_summary(user_id=user.id)
    started = client.post(
        "/v2/coach/start",
        json={"summary_id": str(summary_id)},
        headers=headers,
    )
    session_id = started.json()["session_id"]
    store.coach_sessions[session_id].status = "closed"
    request_id = uuid4()

    def fail_history(_user_id):
        raise RuntimeError("history unavailable")

    store.list_reports = fail_history
    with pytest.raises(RuntimeError, match="history unavailable"):
        _post(
            client,
            "/v2/reports",
            headers=headers,
            request_id=request_id,
            body={"session_id": session_id},
        )
    operation = store.get_external_operation(
        user_id=user.id,
        request_id=request_id,
    )
    assert operation.status == OperationStatus.FAILED
    assert operation.error_code == "report_failed"


def test_coach_and_reports_require_bearer_and_share_user_rate_limit():
    client, store, _, user, headers = _application(
        responses=[FakeModelResponse(parsed=COACH_QUESTION)],
        clock=lambda: 0.0,
    )
    summary_id = store.seed_summary(user_id=user.id)
    assert client.get("/v2/reports").status_code == 401
    assert client.post(
        "/v2/coach/start", json={"summary_id": str(summary_id)}
    ).status_code == 401
    assert client.post(
        "/v2/coach/start",
        json={"summary_id": str(summary_id)},
        headers=headers,
    ).status_code == 200
    for _ in range(59):
        assert client.get("/v2/reports", headers=headers).status_code == 200
    assert client.get("/v2/reports", headers=headers).status_code == 429
