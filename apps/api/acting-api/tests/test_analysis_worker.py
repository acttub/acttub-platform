from __future__ import annotations

from datetime import datetime, timedelta, timezone
import os
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient

from acting_agent.config import Settings as AgentSettings
from acting_api.analysis_worker import (
    AnalysisResult,
    AnalysisWorker,
    SummaryAnalyzer,
    TRANSCRIPTION_SYSTEM_PROMPT,
    UnsupportedMediaError,
    transcript_segments_from_text,
)
from acting_api.app import create_app
from acting_api.config import GatewaySettings
from acting_api.db.models import OperationStatus, PracticeStatus, UploadStatus
from acting_api.storage import S3Storage
from acting_report.config import Settings as ReportSettings
from acting_summary import compress as compress_mod
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
        self.result = result or AnalysisResult(
            observation_pack=SUMMARY, was_compressed=False
        )
        self.error = error
        self.paths = []
        self.contents = []

    def analyze(self, video_path, session, *, duration_ms=None):
        assert duration_ms == 1000
        self.paths.append(video_path)
        with open(video_path, "rb") as video:
            self.contents.append(video.read())
        if self.error:
            raise self.error
        return self.result


def _pending_analysis(
    *,
    content=b"video-bytes",
    blockage_kind="그 외",
    sub_branch="그 외",
):
    store = FakePlatformStore()
    user = store.create_user()
    upload = finalized_upload(store, user.id, content_size=len(content))
    created = store.create_practice_session_with_analysis_operation(
        user_id=user.id,
        upload_intent_id=upload.id,
        situation="situation",
        character_context="character",
        goal="goal",
        blockage_kind=blockage_kind,
        sub_branch=sub_branch,
        request_id=uuid4(),
        request_fingerprint="a" * 64,
    )
    client = FakeBotoS3Client()
    upload.etag = client.put(
        bucket="videos", key=upload.object_key, content=content
    )
    storage = S3Storage(bucket="videos", client=client)
    return store, created.session, created.operation, storage


def test_transcription_system_prompt_matches_so_source_character_for_character():
    assert TRANSCRIPTION_SYSTEM_PROMPT == """너는 연기 영상의 음성을 한국어로 받아쓴다.

- 실제로 들리는 발화만 적고, 해석·요약·화자 이름·행동 묘사를 넣지 않는다.
- 앞뒤 대사의 연결이 보이도록 모든 발화를 정확한 순서로 적는다.
- 대사 하나마다 줄을 바꾼다. 시각, 화자 표지, 글머리표는 붙이지 않는다.
- 알아듣지 못한 부분을 문맥으로 지어내지 않는다. 발화가 없거나 전혀 알아들을 수 없으면 빈 문자열을 낸다."""


def test_transcript_segments_split_newlines_and_sentence_punctuation():
    assert transcript_segments_from_text(
        "첫 문장. 다음 문장?\r\n\r\n셋！ 넷\n   \n마지막"
    ) == ("첫 문장.", "다음 문장?", "셋！", "넷", "마지막")


@pytest.mark.parametrize("blockage_kind", ["표현", "그 외"])
def test_non_analysis_sessions_do_not_call_transcription(
    monkeypatch,
    tmp_path,
    blockage_kind,
):
    monkeypatch.setattr(compress_mod, "compress_for_gemini", lambda path: path)
    monkeypatch.setattr(summarizer_mod, "summarize", lambda *args, **kwargs: SUMMARY)

    def unexpected_call(*args, **kwargs):
        raise AssertionError("transcription must not run")

    analyzer = SummaryAnalyzer(
        client=object(),
        model="gemini-test",
        extract_audio=unexpected_call,
        transcribe_audio=unexpected_call,
    )
    result = analyzer.analyze(
        str(tmp_path / "video.mp4"),
        SimpleNamespace(
            blockage_kind=blockage_kind,
            situation="상황",
            character_context="인물",
            goal="목적",
            blockage_detail="상세",
        ),
        duration_ms=1000,
    )

    assert result.observation_pack == SUMMARY
    assert result.transcripts == ()


def test_analysis_transcribes_after_gemini_and_cleans_audio(monkeypatch, tmp_path):
    events = []
    monkeypatch.setattr(compress_mod, "compress_for_gemini", lambda path: path)

    def summarize(*args, **kwargs):
        events.append("gemini")
        return SUMMARY

    audio_dir = tmp_path / "transcription-job"
    audio_path = audio_dir / "audio.mp3"

    def extract_audio(video_path, duration_ms):
        events.append("extract")
        assert duration_ms == 120_000
        audio_dir.mkdir()
        audio_path.write_bytes(b"mp3")
        return audio_path

    def transcribe_audio(path, system_prompt):
        events.append("transcribe")
        assert path == audio_path
        assert system_prompt == TRANSCRIPTION_SYSTEM_PROMPT
        return "첫 대사. 다음 대사?\n마지막 대사", object()

    monkeypatch.setattr(summarizer_mod, "summarize", summarize)
    analyzer = SummaryAnalyzer(
        client=object(),
        model="gemini-test",
        extract_audio=extract_audio,
        transcribe_audio=transcribe_audio,
    )

    result = analyzer.analyze(
        str(tmp_path / "video.mp4"),
        SimpleNamespace(
            blockage_kind="분석",
            situation="상황",
            character_context="인물",
            goal="목적",
            blockage_detail="상세",
        ),
        duration_ms=1000,
    )

    assert events == ["gemini", "extract", "transcribe"]
    assert result.transcripts == ("첫 대사.", "다음 대사?", "마지막 대사")
    assert not audio_path.exists()
    assert not audio_dir.exists()


def test_transcription_failure_still_saves_observation_and_marks_analyzed(
    monkeypatch,
    tmp_path,
):
    store, session, operation, storage = _pending_analysis(
        blockage_kind="분석",
        sub_branch="대사 분석",
    )
    monkeypatch.setattr(compress_mod, "compress_for_gemini", lambda path: path)
    monkeypatch.setattr(summarizer_mod, "summarize", lambda *args, **kwargs: SUMMARY)
    audio_dir = tmp_path / "failed-transcription"
    audio_path = audio_dir / "audio.mp3"

    def extract_audio(video_path, duration_ms):
        audio_dir.mkdir()
        audio_path.write_bytes(b"mp3")
        return audio_path

    def fail_transcription(path, system_prompt):
        raise RuntimeError("offline transcription failure")

    worker = AnalysisWorker(
        store=store,
        storage=storage,
        analyzer=SummaryAnalyzer(
            client=object(),
            model="gemini-test",
            extract_audio=extract_audio,
            transcribe_audio=fail_transcription,
        ),
        model="gemini-test",
    )

    assert worker.run_once() is True
    assert session.status == PracticeStatus.ANALYZED
    assert operation.status == OperationStatus.SUCCEEDED
    assert next(iter(store.summaries.values())).raw == SUMMARY.model_dump(mode="json")
    assert store.transcripts[session.id] == []
    assert not audio_path.exists()
    assert not audio_dir.exists()


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
