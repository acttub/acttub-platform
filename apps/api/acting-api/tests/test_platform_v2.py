from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient

from acting_agent.config import Settings as AgentSettings
from acting_api.app import create_app
from acting_api.auth.jwt import JwtService
from acting_api.config import GatewaySettings
from acting_api.db.models import OperationStatus, PracticeStatus, UploadStatus
from acting_api.storage import S3Storage
from acting_api.uploads import MAX_UPLOAD_BYTES
from acting_report.config import Settings as ReportSettings
from acting_summary.config import Settings as SummarySettings
from api_test_support import FakeClient, SUMMARY
from platform_test_support import (
    FakeBotoS3Client,
    FakePlatformStore,
    finalized_upload,
)

JWT_SECRET = "stage-3-test-secret"


def _application(*, store=None):
    store = store or FakePlatformStore()
    s3_client = FakeBotoS3Client()
    storage = S3Storage(bucket="videos", client=s3_client)
    app = create_app(
        client=FakeClient(),
        gateway_settings=GatewaySettings(
            database_url="postgresql+psycopg://unused/unused",
            jwt_secret=JWT_SECRET,
        ),
        summary_settings=SummarySettings(api_key="k", model="model-test"),
        agent_settings=AgentSettings(api_key="k", model="model-test"),
        report_settings=ReportSettings(api_key="k", model="model-test"),
        store=store,
        s3_storage=storage,
    )
    user = store.create_user()
    access = JwtService(JWT_SECRET).issue_access_token(user.id).value
    headers = {"Authorization": f"Bearer {access}"}
    return TestClient(app), store, s3_client, user, headers


def _session_body(upload_id, **overrides):
    body = {
        "upload_intent_id": str(upload_id),
        "situation": "오디션 직전",
        "character_context": "불안한 배우",
        "subtext": "침착한 척한다",
    }
    body.update(overrides)
    return body


def _create_session(client, headers, upload_id, request_id=None):
    request_id = request_id or uuid4()
    return client.post(
        "/v2/practice-sessions",
        json=_session_body(upload_id),
        headers={**headers, "X-Request-Id": str(request_id)},
    )


def test_app_builds_storage_from_injected_boto_client_without_aws_calls():
    store = FakePlatformStore()
    s3_client = FakeBotoS3Client()
    app = create_app(
        client=FakeClient(),
        gateway_settings=GatewaySettings(
            database_url="postgresql+psycopg://unused/unused",
            jwt_secret=JWT_SECRET,
            s3_bucket="videos",
            aws_access_key_id="test",
            aws_secret_access_key="test",
            aws_region="ap-northeast-2",
        ),
        summary_settings=SummarySettings(api_key="k", model="m"),
        agent_settings=AgentSettings(api_key="k", model="m"),
        report_settings=ReportSettings(api_key="k", model="m"),
        store=store,
        s3_client=s3_client,
    )
    assert app.state.s3_storage._client is s3_client


def test_upload_intent_issues_presigned_put_with_user_scoped_object_key():
    client, store, s3, user, headers = _application()
    response = client.post(
        "/v2/uploads/intents",
        json={"mime_type": "video/mp4", "size_bytes": 12, "duration_ms": 9000},
        headers=headers,
    )
    assert response.status_code == 201
    body = response.json()
    intent = store.uploads[UUID(body["intent_id"])]
    assert intent.object_key.startswith(f"users/{user.id}/uploads/")
    assert intent.object_key.endswith(".mp4")
    assert intent.storage_provider == "s3"
    assert body["upload_url"].startswith("https://s3.example/put_object/")
    assert intent.expires_at - intent.created_at <= timedelta(minutes=31)
    assert s3.presign_calls[0][1]["ExpiresIn"] == 1800


def test_upload_intent_rejects_oversize_and_non_video_mime():
    client, store, _, _, headers = _application()
    too_large = client.post(
        "/v2/uploads/intents",
        json={"mime_type": "video/mp4", "size_bytes": MAX_UPLOAD_BYTES + 1},
        headers=headers,
    )
    unsupported = client.post(
        "/v2/uploads/intents",
        json={"mime_type": "image/png", "size_bytes": 12},
        headers=headers,
    )
    assert too_large.status_code == 413
    assert unsupported.status_code == 415
    assert store.uploads == {}


def test_upload_complete_requires_object_and_exact_size_then_finalizes():
    client, store, s3, _, headers = _application()
    created = client.post(
        "/v2/uploads/intents",
        json={"mime_type": "video/mp4", "size_bytes": 12},
        headers=headers,
    ).json()
    intent = store.uploads[UUID(created["intent_id"])]
    url = f"/v2/uploads/intents/{intent.id}/complete"

    assert client.post(url, headers=headers).json()["detail"] == "upload_not_found"
    s3.put(bucket="videos", key=intent.object_key, content=b"short")
    mismatch = client.post(url, headers=headers)
    assert mismatch.status_code == 409
    assert mismatch.json()["detail"] == "upload_size_mismatch"

    s3.put(bucket="videos", key=intent.object_key, content=b"x" * 12)
    completed = client.post(url, headers=headers)
    assert completed.status_code == 200
    assert completed.json()["status"] == "finalized"
    assert intent.status == UploadStatus.FINALIZED
    assert intent.etag == s3.head_object(
        Bucket="videos", Key=intent.object_key
    )["ETag"]


def test_concurrent_duplicate_upload_complete_returns_idempotent_success():
    class FinalizeRaceStore(FakePlatformStore):
        def finalize_upload_intent(self, **kwargs):
            finalized = super().finalize_upload_intent(**kwargs)
            assert finalized is not None
            return None

    client, store, s3, _, headers = _application(store=FinalizeRaceStore())
    created = client.post(
        "/v2/uploads/intents",
        json={"mime_type": "video/mp4", "size_bytes": 12},
        headers=headers,
    ).json()
    intent = store.uploads[UUID(created["intent_id"])]
    s3.put(bucket="videos", key=intent.object_key, content=b"x" * 12)

    response = client.post(
        f"/v2/uploads/intents/{intent.id}/complete", headers=headers
    )

    assert response.status_code == 200
    assert response.json() == {
        "intent_id": str(intent.id),
        "status": "finalized",
    }


def test_upload_complete_expired_is_409_and_other_owner_is_404():
    client, store, _, _, headers = _application()
    created = client.post(
        "/v2/uploads/intents",
        json={"mime_type": "video/mp4", "size_bytes": 12},
        headers=headers,
    ).json()
    intent = store.uploads[UUID(created["intent_id"])]
    intent.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    assert (
        client.post(
            f"/v2/uploads/intents/{intent.id}/complete", headers=headers
        ).status_code
        == 409
    )

    other = store.create_user()
    other_token = JwtService(JWT_SECRET).issue_access_token(other.id).value
    other_headers = {"Authorization": f"Bearer {other_token}"}
    assert (
        client.post(
            f"/v2/uploads/intents/{intent.id}/complete", headers=other_headers
        ).status_code
        == 404
    )


def test_practice_session_missing_request_id_is_generated_and_pending_is_idempotent():
    client, store, _, user, headers = _application()
    upload = finalized_upload(store, user.id)
    first = client.post(
        "/v2/practice-sessions",
        json=_session_body(upload.id),
        headers=headers,
    )
    assert first.status_code == 202
    generated = UUID(first.headers["X-Request-Id"])
    session_id = first.json()["session_id"]
    duplicate = client.post(
        "/v2/practice-sessions",
        json=_session_body(upload.id),
        headers={**headers, "X-Request-Id": str(generated)},
    )
    assert duplicate.status_code == 202
    assert duplicate.json()["session_id"] == session_id
    assert len(store.sessions) == 1
    assert len(store.operations) == 1


def test_practice_session_running_succeeded_failed_and_fingerprint_branches():
    client, store, _, user, headers = _application()
    upload = finalized_upload(store, user.id)
    request_id = uuid4()
    first = _create_session(client, headers, upload.id, request_id)
    operation = next(iter(store.operations.values()))
    session = next(iter(store.sessions.values()))

    operation.status = OperationStatus.RUNNING
    operation.lease_token = uuid4()
    running = _create_session(client, headers, upload.id, request_id)
    assert running.status_code == 202
    assert running.json() == {"session_id": str(session.id), "status": "analyzing"}

    operation.status = OperationStatus.SUCCEEDED
    operation.response_payload = {
        "session_id": str(session.id),
        "status": "analyzed",
        "summary_id": str(uuid4()),
    }
    succeeded = _create_session(client, headers, upload.id, request_id)
    assert succeeded.status_code == 200
    assert succeeded.json() == operation.response_payload

    mismatch = client.post(
        "/v2/practice-sessions",
        json=_session_body(upload.id, situation="different"),
        headers={**headers, "X-Request-Id": str(request_id)},
    )
    assert mismatch.status_code == 422

    operation.status = OperationStatus.FAILED
    operation.attempt_count = 1
    operation.lease_token = None
    operation.error_code = "gemini_timeout"
    session.status = PracticeStatus.FAILED
    failed_retry = _create_session(client, headers, upload.id, request_id)
    assert failed_retry.status_code == 202
    assert operation.status == OperationStatus.PENDING
    assert session.status == PracticeStatus.ANALYZING
    assert first.status_code == 202


def test_practice_session_rejects_unfinalized_or_reused_upload():
    client, store, _, user, headers = _application()
    pending = store.create_upload_intent(
        user_id=user.id,
        storage_provider="s3",
        object_key=f"users/{user.id}/pending.mp4",
        mime_type="video/mp4",
        size_bytes=12,
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=30),
    )
    assert _create_session(client, headers, pending.id).status_code == 409

    upload = finalized_upload(store, user.id)
    assert _create_session(client, headers, upload.id).status_code == 202
    assert _create_session(client, headers, upload.id).status_code == 409


def test_practice_session_hides_missing_or_foreign_upload_intent():
    client, store, _, _, headers = _application()
    other = store.create_user()
    foreign = finalized_upload(store, other.id)

    for upload_id in (foreign.id, uuid4()):
        response = _create_session(client, headers, upload_id)
        assert response.status_code == 404
        assert response.json()["detail"] == "upload_intent_not_found"


def test_session_list_detail_summary_failure_ownership_and_soft_delete():
    client, store, _, user, headers = _application()
    first_upload = finalized_upload(store, user.id, suffix="first")
    second_upload = finalized_upload(store, user.id, suffix="second")
    first = _create_session(client, headers, first_upload.id).json()
    second = _create_session(client, headers, second_upload.id).json()
    first_session = store.sessions[UUID(first["session_id"])]
    second_session = store.sessions[UUID(second["session_id"])]
    first_session.created_at -= timedelta(minutes=1)

    listed = client.get("/v2/practice-sessions", headers=headers).json()["sessions"]
    assert [item["session_id"] for item in listed] == [
        str(second_session.id),
        str(first_session.id),
    ]

    first_session.status = PracticeStatus.ANALYZED
    summary_id = uuid4()
    store.summaries[summary_id] = SimpleNamespace(
        id=summary_id,
        session_id=first_session.id,
        raw=SUMMARY.model_dump(mode="json"),
        created_at=datetime.now(timezone.utc),
    )
    detail = client.get(
        f"/v2/practice-sessions/{first_session.id}", headers=headers
    )
    assert detail.status_code == 200
    assert detail.json()["summary"]["summary_id"] == str(summary_id)
    assert detail.json()["playback_url"].startswith(
        "https://s3.example/get_object/"
    )

    other = store.create_user()
    other_access = JwtService(JWT_SECRET).issue_access_token(other.id).value
    assert (
        client.get(
            f"/v2/practice-sessions/{first_session.id}",
            headers={"Authorization": f"Bearer {other_access}"},
        ).status_code
        == 404
    )

    deleted = client.delete(
        f"/v2/practice-sessions/{first_session.id}", headers=headers
    )
    assert deleted.status_code == 204
    assert (
        client.get(
            f"/v2/practice-sessions/{first_session.id}", headers=headers
        ).status_code
        == 404
    )
    assert client.delete(
        f"/v2/practice-sessions/{first_session.id}", headers=headers
    ).status_code == 404


@pytest.mark.parametrize(
    "error_code",
    [
        "gemini_timeout",
        "gemini_parse_error",
        "unsupported_media",
        "max_attempts_exceeded",
    ],
)
def test_failed_session_detail_exposes_supported_error_codes(error_code):
    client, store, _, user, headers = _application()
    upload = finalized_upload(store, user.id)
    created = _create_session(client, headers, upload.id).json()
    session = store.sessions[UUID(created["session_id"])]
    operation = next(
        row for row in store.operations.values() if row.session_id == session.id
    )
    session.status = PracticeStatus.FAILED
    operation.status = OperationStatus.FAILED
    operation.error_code = error_code

    detail = client.get(f"/v2/practice-sessions/{session.id}", headers=headers)
    assert detail.status_code == 200
    assert detail.json()["error_code"] == error_code


def test_reanalysis_requires_failed_session_and_is_idempotent():
    client, store, _, user, headers = _application()
    upload = finalized_upload(store, user.id)
    created = _create_session(client, headers, upload.id).json()
    session = store.sessions[UUID(created["session_id"])]
    assert (
        client.post(
            f"/v2/practice-sessions/{session.id}/analyze", headers=headers
        ).status_code
        == 409
    )

    session.status = PracticeStatus.FAILED
    request_id = uuid4()
    retry_headers = {**headers, "X-Request-Id": str(request_id)}
    retried = client.post(
        f"/v2/practice-sessions/{session.id}/analyze", headers=retry_headers
    )
    assert retried.status_code == 202
    assert session.status == PracticeStatus.ANALYZING
    duplicate = client.post(
        f"/v2/practice-sessions/{session.id}/analyze", headers=retry_headers
    )
    assert duplicate.status_code == 202
