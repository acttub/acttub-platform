from __future__ import annotations

from datetime import datetime, timedelta, timezone
import os
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient

from acting_agent.config import Settings as AgentSettings
from acting_api.analysis_worker import (
    AnalysisResult,
    AnalysisWorker,
    UnsupportedMediaError,
)
from acting_api.app import create_app
from acting_api.config import GatewaySettings
from acting_api.db.models import OperationStatus, PracticeStatus, UploadStatus
from acting_api.storage import S3Storage
from acting_report.config import Settings as ReportSettings
from acting_summary import summarizer as summarizer_mod
from acting_summary.config import Settings as SummarySettings
from api_test_support import FakeClient, SUMMARY
from platform_test_support import (
    FakeBotoS3Client,
    FakePlatformStore,
    finalized_upload,
)


class FakeAnalyzer:
    def __init__(self, *, result=None, error=None):
        self.result = result or AnalysisResult(summary=SUMMARY, was_compressed=False)
        self.error = error
        self.paths = []
        self.contents = []

    def analyze(self, video_path, session):
        self.paths.append(video_path)
        with open(video_path, "rb") as video:
            self.contents.append(video.read())
        if self.error:
            raise self.error
        return self.result


def _pending_analysis(*, content=b"video-bytes"):
    store = FakePlatformStore()
    user = store.create_user()
    upload = finalized_upload(store, user.id, content_size=len(content))
    created = store.create_practice_session_with_analysis_operation(
        user_id=user.id,
        upload_intent_id=upload.id,
        situation="situation",
        character_context="character",
        subtext="subtext",
        request_id=uuid4(),
        request_fingerprint="a" * 64,
    )
    client = FakeBotoS3Client()
    upload.etag = client.put(
        bucket="videos", key=upload.object_key, content=content
    )
    storage = S3Storage(bucket="videos", client=client)
    return store, created.session, created.operation, storage


def test_worker_cycle_claims_downloads_analyzes_and_atomically_completes():
    store, session, operation, storage = _pending_analysis()
    analyzer = FakeAnalyzer()
    worker = AnalysisWorker(
        store=store,
        storage=storage,
        analyzer=analyzer,
        model="gemini-test",
    )

    assert worker.run_once() is True

    assert session.status == PracticeStatus.ANALYZED
    assert operation.status == OperationStatus.SUCCEEDED
    assert operation.attempt_count == 1
    assert operation.response_payload["session_id"] == str(session.id)
    assert UUID(operation.response_payload["summary_id"]) in store.summaries
    assert analyzer.contents == [b"video-bytes"]
    assert not os.path.exists(analyzer.paths[0])


@pytest.mark.parametrize(
    ("error", "expected_code"),
    [
        (summarizer_mod.FileActiveTimeout("timeout"), "gemini_timeout"),
        (summarizer_mod.SummaryParseError("parse"), "gemini_parse_error"),
        (UnsupportedMediaError("media"), "unsupported_media"),
    ],
)
def test_worker_maps_analysis_failures_to_stable_error_codes(error, expected_code):
    store, session, operation, storage = _pending_analysis()
    worker = AnalysisWorker(
        store=store,
        storage=storage,
        analyzer=FakeAnalyzer(error=error),
        model="gemini-test",
    )
    assert worker.run_once() is True
    assert session.status == PracticeStatus.FAILED
    assert operation.status == OperationStatus.FAILED
    assert operation.error_code == expected_code
    assert operation.lease_token is None
    assert worker.run_once() is False
    assert operation.attempt_count == 1


def test_worker_sweeps_expired_uploads_and_exhausted_attempts():
    store, session, operation, storage = _pending_analysis()
    now = datetime.now(timezone.utc)
    expired = store.create_upload_intent(
        user_id=session.user_id,
        storage_provider="s3",
        object_key=f"users/{session.user_id}/expired.mp4",
        mime_type="video/mp4",
        size_bytes=1,
        expires_at=now - timedelta(seconds=1),
    )
    operation.status = OperationStatus.FAILED
    operation.attempt_count = 3
    operation.lease_token = None
    worker = AnalysisWorker(
        store=store,
        storage=storage,
        analyzer=FakeAnalyzer(),
        model="gemini-test",
    )
    storage._client.put(
        bucket="videos", key=expired.object_key, content=b"x"
    )

    assert worker.sweep(now=now) == (1, 1)
    assert expired.status == UploadStatus.EXPIRED
    assert storage._client.delete_calls == [("videos", expired.object_key)]
    assert ("videos", expired.object_key) not in storage._client.objects
    assert operation.error_code == "max_attempts_exceeded"
    assert session.status == PracticeStatus.FAILED


def test_expired_upload_stays_expired_when_best_effort_s3_delete_fails():
    store, session, _, storage = _pending_analysis()
    now = datetime.now(timezone.utc)
    expired = store.create_upload_intent(
        user_id=session.user_id,
        storage_provider="s3",
        object_key=f"users/{session.user_id}/undeletable.mp4",
        mime_type="video/mp4",
        size_bytes=1,
        expires_at=now - timedelta(seconds=1),
    )
    storage._client.put(
        bucket="videos", key=expired.object_key, content=b"x"
    )

    def fail_delete(*, Bucket, Key):
        storage._client.delete_calls.append((Bucket, Key))
        raise ConnectionError("s3 delete unavailable")

    storage._client.delete_object = fail_delete
    worker = AnalysisWorker(
        store=store,
        storage=storage,
        analyzer=FakeAnalyzer(),
        model="gemini-test",
    )

    assert worker.sweep(now=now) == (1, 0)
    assert expired.status == UploadStatus.EXPIRED
    assert storage._client.delete_calls == [("videos", expired.object_key)]


def test_max_attempt_sweep_is_one_shot_and_cannot_regress_successful_retry():
    store, session, operation, storage = _pending_analysis()
    now = datetime.now(timezone.utc)
    operation.status = OperationStatus.PENDING
    operation.attempt_count = 3
    operation.lease_token = None

    worker = AnalysisWorker(
        store=store,
        storage=storage,
        analyzer=FakeAnalyzer(),
        model="gemini-test",
    )
    assert worker.sweep(now=now) == (0, 1)
    assert session.status == PracticeStatus.FAILED

    retry = store.create_analysis_retry_operation(
        user_id=session.user_id,
        session_id=session.id,
        request_id=uuid4(),
        request_fingerprint="b" * 64,
        now=now + timedelta(seconds=1),
    )
    assert retry is not None
    assert worker.run_once(now=now + timedelta(seconds=2)) is True
    assert session.status == PracticeStatus.ANALYZED

    assert worker.sweep(now=now + timedelta(minutes=1)) == (0, 0)
    assert session.status == PracticeStatus.ANALYZED


def test_changed_object_etag_is_requeued_without_stale_analysis():
    store, session, operation, storage = _pending_analysis(content=b"video-A")
    storage._client.put(
        bucket="videos",
        key=store.uploads[session.upload_intent_id].object_key,
        content=b"video-B",
    )
    analyzer = FakeAnalyzer()
    worker = AnalysisWorker(
        store=store,
        storage=storage,
        analyzer=analyzer,
        model="gemini-test",
    )

    assert worker.run_once() is True

    assert analyzer.paths == []
    assert session.status == PracticeStatus.ANALYZING
    assert operation.status == OperationStatus.PENDING
    assert operation.attempt_count == 1
    assert store.summaries == {}


def test_transient_storage_errors_requeue_until_sweep_exhausts_budget():
    store, session, operation, storage = _pending_analysis()

    class UnavailableStorage:
        def download_to_path(self, **kwargs):
            raise ConnectionError("s3 unavailable")

    worker = AnalysisWorker(
        store=store,
        storage=UnavailableStorage(),
        analyzer=FakeAnalyzer(),
        model="gemini-test",
    )

    for attempt in range(1, 4):
        assert worker.run_once() is True
        assert operation.status == OperationStatus.PENDING
        assert operation.attempt_count == attempt
        assert session.status == PracticeStatus.ANALYZING

    assert worker.run_once() is False
    assert worker.sweep() == (0, 1)
    assert operation.status == OperationStatus.FAILED
    assert operation.error_code == "max_attempts_exceeded"
    assert session.status == PracticeStatus.FAILED


def test_expired_lease_is_reclaimed_by_another_worker():
    store, session, operation, storage = _pending_analysis()
    now = datetime.now(timezone.utc)
    first_token = uuid4()
    first_claim = store.claim_next_external_operation(
        kind="analyze",
        lease_token=first_token,
        lease_duration=timedelta(minutes=10),
        now=now,
    )
    assert first_claim.id == operation.id
    assert first_claim.attempt_count == 1

    analyzer = FakeAnalyzer()
    second_worker = AnalysisWorker(
        store=store,
        storage=storage,
        analyzer=analyzer,
        model="gemini-test",
        lease_duration=timedelta(minutes=10),
    )
    assert second_worker.run_once(now=now + timedelta(minutes=9)) is False
    assert second_worker.run_once(now=now + timedelta(minutes=11)) is True
    assert operation.attempt_count == 2
    assert operation.status == OperationStatus.SUCCEEDED
    assert session.status == PracticeStatus.ANALYZED


def test_analysis_worker_is_started_and_stopped_by_app_lifespan():
    class RecordingPool:
        def __init__(self):
            self.started = False
            self.stopped = False

        def start(self):
            self.started = True

        def stop(self):
            self.stopped = True

    pool = RecordingPool()
    app = create_app(
        client=FakeClient(),
        gateway_settings=GatewaySettings(
            database_url="postgresql+psycopg://unused/unused",
            jwt_secret="secret",
        ),
        summary_settings=SummarySettings(api_key="k", model="m"),
        agent_settings=AgentSettings(api_key="k", model="m"),
        report_settings=ReportSettings(api_key="k", model="m"),
        store=FakePlatformStore(),
        analysis_worker=pool,
    )
    with TestClient(app):
        assert pool.started is True
        assert pool.stopped is False
    assert pool.stopped is True
