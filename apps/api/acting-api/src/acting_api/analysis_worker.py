from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import logging
import os
from pathlib import Path
import tempfile
import threading
import time
from uuid import uuid4

from acting_api.db.store import LeaseOwnershipError
from acting_summary import compress as compress_mod
from acting_summary import summarizer as summarizer_mod
from acting_summary.schema import SceneSummary, SubText

logger = logging.getLogger(__name__)


class UnsupportedMediaError(RuntimeError):
    pass


class ObjectETagMismatchError(RuntimeError):
    pass


@dataclass(frozen=True)
class AnalysisResult:
    summary: SceneSummary
    was_compressed: bool


class SummaryAnalyzer:
    def __init__(self, *, client, model: str):
        self._client = client
        self.model = model

    def analyze(self, video_path: str, session) -> AnalysisResult:
        send_path = video_path
        try:
            send_path = compress_mod.compress_for_gemini(video_path)
            summary = summarizer_mod.summarize(
                send_path,
                SubText(
                    situation=session.situation,
                    character=session.character_context,
                    subtext=session.subtext,
                ),
                client=self._client,
                model=self.model,
            )
            return AnalysisResult(
                summary=summary,
                was_compressed=(send_path != video_path),
            )
        finally:
            if send_path != video_path:
                Path(send_path).unlink(missing_ok=True)


def analysis_error_code(exc: Exception) -> str | None:
    if isinstance(exc, (summarizer_mod.FileActiveTimeout, TimeoutError)):
        return "gemini_timeout"
    if isinstance(exc, summarizer_mod.SummaryParseError):
        return "gemini_parse_error"
    if isinstance(exc, UnsupportedMediaError):
        return "unsupported_media"
    return None


class AnalysisWorker:
    def __init__(
        self,
        *,
        store,
        storage,
        analyzer,
        lease_duration: timedelta = timedelta(minutes=10),
        model: str,
    ):
        self.store = store
        self.storage = storage
        self.analyzer = analyzer
        self.lease_duration = lease_duration
        self.model = model

    def run_once(self, *, now: datetime | None = None) -> bool:
        now = now or datetime.now(timezone.utc)
        lease_token = uuid4()
        operation = self.store.claim_next_external_operation(
            kind="analyze",
            lease_token=lease_token,
            lease_duration=self.lease_duration,
            now=now,
        )
        if operation is None:
            return False
        context = self.store.get_analysis_context(operation.id)
        if context is None:
            self._fail(operation.id, lease_token, UnsupportedMediaError("missing input"), now)
            return True
        if not context.upload.mime_type.lower().startswith("video/"):
            self._fail(
                operation.id,
                lease_token,
                UnsupportedMediaError(context.upload.mime_type),
                now,
            )
            return True

        suffix = Path(context.upload.object_key).suffix or ".video"
        temporary = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
        temporary_path = temporary.name
        temporary.close()
        try:
            downloaded = self.storage.download_to_path(
                object_key=context.upload.object_key,
                destination=temporary_path,
            )
            if downloaded.etag != context.upload.etag:
                raise ObjectETagMismatchError(
                    "uploaded object changed after finalization"
                )
            result = self.analyzer.analyze(temporary_path, context.session)
            self.store.complete_analysis_operation(
                operation_id=operation.id,
                lease_token=lease_token,
                summary=result.summary,
                model=self.model,
                was_compressed=result.was_compressed,
                response_payload={
                    "session_id": str(operation.session_id),
                    "status": "analyzed",
                },
                now=now,
            )
        except LeaseOwnershipError:
            logger.warning("analysis lease ownership was lost: %s", operation.id)
        except Exception as exc:
            logger.warning("analysis failed: %s", operation.id, exc_info=True)
            error_code = analysis_error_code(exc)
            if error_code is None:
                self._release(operation.id, lease_token, now)
            else:
                self._fail(operation.id, lease_token, error_code, now)
        finally:
            if os.path.exists(temporary_path):
                os.unlink(temporary_path)
        return True

    def sweep(self, *, now: datetime | None = None) -> tuple[int, int]:
        now = now or datetime.now(timezone.utc)
        expired_object_keys = self.store.sweep_expired_upload_intents(now=now)
        for object_key in expired_object_keys:
            try:
                self.storage.delete(object_key=object_key)
            except Exception:
                logger.warning(
                    "expired upload object deletion failed: %s",
                    object_key,
                    exc_info=True,
                )
        exhausted_operations = self.store.sweep_max_attempts_operations(now=now)
        return len(expired_object_keys), exhausted_operations

    def _fail(
        self,
        operation_id,
        lease_token,
        error_code: str | Exception,
        now: datetime,
    ) -> None:
        if isinstance(error_code, Exception):
            mapped = analysis_error_code(error_code)
            if mapped is None:
                self._release(operation_id, lease_token, now)
                return
            error_code = mapped
        try:
            self.store.fail_external_operation(
                operation_id=operation_id,
                lease_token=lease_token,
                error_code=error_code,
                fail_session=True,
                now=now,
            )
        except LeaseOwnershipError:
            logger.warning("analysis failure lease was lost: %s", operation_id)

    def _release(self, operation_id, lease_token, now: datetime) -> None:
        try:
            self.store.release_external_operation(
                operation_id=operation_id,
                lease_token=lease_token,
                now=now,
            )
        except LeaseOwnershipError:
            logger.warning("analysis retry lease was lost: %s", operation_id)


class AnalysisWorkerPool:
    def __init__(
        self,
        *,
        worker: AnalysisWorker,
        concurrency: int = 1,
        poll_interval_sec: float = 2.0,
        sweep_interval_sec: float = 60.0,
        monotonic=time.monotonic,
    ):
        if concurrency <= 0:
            raise ValueError("worker concurrency must be positive")
        self.worker = worker
        self.concurrency = concurrency
        self.poll_interval_sec = poll_interval_sec
        self.sweep_interval_sec = sweep_interval_sec
        self._monotonic = monotonic
        self._stop_event = threading.Event()
        self._threads: list[threading.Thread] = []

    def start(self) -> None:
        if self._threads:
            return
        self._stop_event.clear()
        for index in range(self.concurrency):
            thread = threading.Thread(
                target=self._run,
                args=(index,),
                name=f"analysis-worker-{index + 1}",
                daemon=True,
            )
            thread.start()
            self._threads.append(thread)

    def stop(self) -> None:
        self._stop_event.set()
        for thread in self._threads:
            thread.join()
        self._threads.clear()

    def _run(self, index: int) -> None:
        next_sweep = self._monotonic()
        while not self._stop_event.is_set():
            if index == 0 and self._monotonic() >= next_sweep:
                try:
                    self.worker.sweep()
                except Exception:
                    logger.warning("analysis maintenance sweep failed", exc_info=True)
                next_sweep = self._monotonic() + self.sweep_interval_sec
            try:
                worked = self.worker.run_once()
            except Exception:
                logger.warning("analysis worker cycle failed", exc_info=True)
                worked = False
            if not worked:
                self._stop_event.wait(self.poll_interval_sec)
