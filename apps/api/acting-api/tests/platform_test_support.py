from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import UUID, uuid4

from acting_agent.schema import CoachSession as AgentCoachSession
from acting_agent.summary_schema import SceneSummary as AgentSceneSummary
from acting_agent.summary_schema import SubText as AgentSubText
from acting_api.db.models import (
    OperationKind,
    OperationStatus,
    PracticeStatus,
    UploadStatus,
)
from acting_api.db.store import (
    AnalysisContext,
    ExternalOperationLookup,
    LeaseOwnershipError,
    PracticeSessionDetail,
    PracticeSessionOperation,
)
from acting_report.schema import ReportRecord
from acting_report.session_schema import CoachSession as ReportCoachSession
from acting_report.session_schema import CoachTurn as ReportCoachTurn
from acting_report.summary_schema import SceneSummary as ReportSceneSummary
from acting_report.summary_schema import SubText as ReportSubText
from api_test_support import SUMMARY, SUBTEXT
from auth_test_support import FakeAuthStore


class FakeS3Error(RuntimeError):
    def __init__(self, code: str):
        super().__init__(code)
        self.response = {"Error": {"Code": code}}


class FakeStreamingBody:
    def __init__(self, content: bytes):
        self.content = content
        self.chunk_sizes = []
        self.closed = False

    def iter_chunks(self, *, chunk_size: int):
        for offset in range(0, len(self.content), chunk_size):
            chunk = self.content[offset : offset + chunk_size]
            self.chunk_sizes.append(len(chunk))
            yield chunk

    def close(self):
        self.closed = True


class FakeBotoS3Client:
    def __init__(self):
        self.objects: dict[tuple[str, str], tuple[bytes, str, str]] = {}
        self.presign_calls = []
        self.delete_calls = []
        self.last_body = None

    def generate_presigned_url(self, method, **kwargs):
        self.presign_calls.append((method, kwargs))
        key = kwargs["Params"]["Key"]
        return f"https://s3.example/{method}/{key}?ttl={kwargs['ExpiresIn']}"

    def head_object(self, *, Bucket, Key):
        record = self.objects.get((Bucket, Key))
        if record is None:
            raise FakeS3Error("404")
        content, content_type, etag = record
        return {
            "ContentLength": len(content),
            "ContentType": content_type,
            "ETag": etag,
        }

    def get_object(self, *, Bucket, Key):
        record = self.objects.get((Bucket, Key))
        if record is None:
            raise FakeS3Error("NoSuchKey")
        content, content_type, etag = record
        body = self.last_body = FakeStreamingBody(content)
        return {
            "Body": body,
            "ContentLength": len(content),
            "ContentType": content_type,
            "ETag": etag,
        }

    def delete_object(self, *, Bucket, Key):
        self.delete_calls.append((Bucket, Key))
        self.objects.pop((Bucket, Key), None)

    def put(
        self,
        *,
        bucket: str,
        key: str,
        content: bytes,
        mime_type="video/mp4",
        etag: str | None = None,
    ):
        object_etag = etag or f'"{len(content):x}-{sum(content):x}"'
        self.objects[(bucket, key)] = (content, mime_type, object_etag)
        return object_etag


class FakePlatformStore(FakeAuthStore):
    def __init__(self):
        super().__init__()
        self.uploads = {}
        self.sessions = {}
        self.operations = {}
        self.operation_requests = {}
        self.summaries = {}
        self.coach_sessions: dict[str, AgentCoachSession] = {}
        self.reports: dict[str, ReportRecord] = {}

    def create_upload_intent(
        self,
        *,
        user_id,
        storage_provider,
        object_key,
        mime_type,
        size_bytes,
        expires_at,
        duration_ms=None,
    ):
        now = datetime.now(timezone.utc)
        row = SimpleNamespace(
            id=uuid4(),
            user_id=user_id,
            status=UploadStatus.PENDING,
            storage_provider=storage_provider,
            object_key=object_key,
            mime_type=mime_type,
            size_bytes=size_bytes,
            duration_ms=duration_ms,
            created_at=now,
            expires_at=expires_at,
            finalized_at=None,
            etag=None,
        )
        self.uploads[row.id] = row
        return row

    def get_upload_intent(self, *, user_id, upload_intent_id):
        row = self.uploads.get(upload_intent_id)
        return row if row is not None and row.user_id == user_id else None

    def finalize_upload_intent(
        self, *, user_id, upload_intent_id, etag=None, now=None
    ):
        now = now or datetime.now(timezone.utc)
        row = self.get_upload_intent(
            user_id=user_id, upload_intent_id=upload_intent_id
        )
        if (
            row is None
            or row.status != UploadStatus.PENDING
            or row.expires_at <= now
        ):
            return None
        row.status = UploadStatus.FINALIZED
        row.finalized_at = now
        row.etag = etag
        return row

    def sweep_expired_upload_intents(self, *, now=None):
        now = now or datetime.now(timezone.utc)
        object_keys = []
        for row in self.uploads.values():
            if row.status == UploadStatus.PENDING and row.expires_at < now:
                row.status = UploadStatus.EXPIRED
                object_keys.append(row.object_key)
        return object_keys

    def create_practice_session_with_analysis_operation(
        self,
        *,
        user_id,
        upload_intent_id,
        situation,
        character_context,
        subtext,
        request_id,
        request_fingerprint,
    ):
        existing = self._operation_by_request(user_id, request_id)
        if existing is not None:
            return PracticeSessionOperation(
                session=self.sessions[existing.session_id],
                operation=existing,
                created=False,
                fingerprint_mismatch=(
                    existing.request_fingerprint != request_fingerprint
                ),
            )
        upload = self.get_upload_intent(
            user_id=user_id, upload_intent_id=upload_intent_id
        )
        if upload is None or upload.status != UploadStatus.FINALIZED:
            return None
        if any(
            row.upload_intent_id == upload_intent_id for row in self.sessions.values()
        ):
            return None
        now = datetime.now(timezone.utc)
        session = SimpleNamespace(
            id=uuid4(),
            user_id=user_id,
            upload_intent_id=upload_intent_id,
            status=PracticeStatus.ANALYZING,
            situation=situation,
            character_context=character_context,
            subtext=subtext,
            hidden_at=None,
            created_at=now,
            updated_at=now,
        )
        self.sessions[session.id] = session
        operation = self._create_operation(
            user_id=user_id,
            session_id=session.id,
            request_id=request_id,
            request_fingerprint=request_fingerprint,
        )
        return PracticeSessionOperation(session, operation, True, False)

    def create_analysis_retry_operation(
        self,
        *,
        user_id,
        session_id,
        request_id,
        request_fingerprint,
        now=None,
    ):
        existing = self._operation_by_request(user_id, request_id)
        if existing is not None:
            return PracticeSessionOperation(
                session=self.sessions[existing.session_id],
                operation=existing,
                created=False,
                fingerprint_mismatch=(
                    existing.session_id != session_id
                    or existing.request_fingerprint != request_fingerprint
                ),
            )
        session = self.get_practice_session(
            user_id=user_id, session_id=session_id
        )
        if session is None or session.status != PracticeStatus.FAILED:
            return None
        session.status = PracticeStatus.ANALYZING
        session.updated_at = now or datetime.now(timezone.utc)
        operation = self._create_operation(
            user_id=user_id,
            session_id=session_id,
            request_id=request_id,
            request_fingerprint=request_fingerprint,
        )
        return PracticeSessionOperation(session, operation, True, False)

    def resume_failed_analysis_operation(
        self, *, user_id, operation_id, now=None, max_attempts=3
    ):
        operation = self.operations.get(operation_id)
        if (
            operation is None
            or operation.user_id != user_id
            or operation.status != OperationStatus.FAILED
            or operation.attempt_count >= max_attempts
            or operation.lease_token is not None
        ):
            return False
        session = self.get_practice_session(
            user_id=user_id, session_id=operation.session_id
        )
        if session is None or session.status != PracticeStatus.FAILED:
            return False
        operation.status = OperationStatus.PENDING
        operation.error_code = None
        operation.response_payload = None
        operation.updated_at = now or datetime.now(timezone.utc)
        session.status = PracticeStatus.ANALYZING
        session.updated_at = operation.updated_at
        return True

    def get_practice_session(
        self, *, user_id, session_id, include_hidden=False
    ):
        row = self.sessions.get(session_id)
        if row is None or row.user_id != user_id:
            return None
        if row.hidden_at is not None and not include_hidden:
            return None
        return row

    def list_practice_sessions(self, user_id):
        return sorted(
            (
                row
                for row in self.sessions.values()
                if row.user_id == user_id and row.hidden_at is None
            ),
            key=lambda row: (row.created_at, row.id),
            reverse=True,
        )

    def get_practice_session_detail(self, *, user_id, session_id):
        session = self.get_practice_session(user_id=user_id, session_id=session_id)
        if session is None:
            return None
        summaries = [
            row for row in self.summaries.values() if row.session_id == session.id
        ]
        operations = [
            row for row in self.operations.values() if row.session_id == session.id
        ]
        return PracticeSessionDetail(
            session=session,
            upload=self.uploads[session.upload_intent_id],
            summary=max(summaries, key=lambda row: (row.created_at, row.id), default=None),
            operation=max(
                operations, key=lambda row: (row.created_at, row.id), default=None
            ),
        )

    def hide_practice_session(self, *, user_id, session_id, now=None):
        session = self.get_practice_session(user_id=user_id, session_id=session_id)
        if session is None:
            return False
        session.hidden_at = now or datetime.now(timezone.utc)
        session.updated_at = session.hidden_at
        return True

    def get_external_operation(self, *, user_id, request_id):
        return self._operation_by_request(user_id, request_id)

    def get_or_create_external_operation(
        self,
        *,
        user_id,
        session_id,
        request_id,
        kind,
        request_fingerprint,
    ):
        practice = self.sessions.get(session_id)
        if practice is None or practice.user_id != user_id:
            raise LookupError("practice session not found")
        existing = self._operation_by_request(user_id, request_id)
        if existing is not None:
            return ExternalOperationLookup(
                operation=existing,
                created=False,
                fingerprint_mismatch=(
                    existing.request_fingerprint != request_fingerprint
                ),
            )
        operation = self._create_operation(
            user_id=user_id,
            session_id=session_id,
            request_id=request_id,
            request_fingerprint=request_fingerprint,
            kind=kind,
        )
        return ExternalOperationLookup(operation, True, False)

    def claim_external_operation(
        self,
        *,
        operation_id,
        lease_token,
        lease_duration,
        now=None,
        max_attempts=3,
    ):
        now = now or datetime.now(timezone.utc)
        operation = self.operations.get(operation_id)
        if (
            operation is None
            or operation.status
            not in {
                OperationStatus.PENDING,
                OperationStatus.RUNNING,
                OperationStatus.FAILED,
            }
            or operation.attempt_count >= max_attempts
            or (
                operation.lease_token is not None
                and operation.lease_expires_at >= now
            )
        ):
            return None
        operation.status = OperationStatus.RUNNING
        operation.attempt_count += 1
        operation.lease_token = lease_token
        operation.lease_expires_at = now + lease_duration
        operation.error_code = None
        operation.response_payload = None
        operation.updated_at = now
        return operation

    def claim_next_external_operation(
        self,
        *,
        kind,
        lease_token,
        lease_duration,
        now=None,
        max_attempts=3,
    ):
        now = now or datetime.now(timezone.utc)
        candidates = [
            row
            for row in self.operations.values()
            if row.kind == OperationKind(kind)
            and row.attempt_count < max_attempts
            and (
                (
                    row.status == OperationStatus.PENDING
                    and row.lease_token is None
                )
                or (
                    row.status == OperationStatus.RUNNING
                    and row.lease_expires_at is not None
                    and row.lease_expires_at < now
                )
            )
        ]
        if not candidates:
            return None
        operation = min(candidates, key=lambda row: (row.created_at, row.id))
        operation.status = OperationStatus.RUNNING
        operation.attempt_count += 1
        operation.lease_token = lease_token
        operation.lease_expires_at = now + lease_duration
        operation.error_code = None
        operation.response_payload = None
        operation.updated_at = now
        self.sessions[operation.session_id].status = PracticeStatus.ANALYZING
        return operation

    def get_analysis_context(self, operation_id):
        operation = self.operations.get(operation_id)
        if operation is None:
            return None
        session = self.sessions[operation.session_id]
        return AnalysisContext(
            operation=operation,
            session=session,
            upload=self.uploads[session.upload_intent_id],
        )

    def complete_analysis_operation(
        self,
        *,
        operation_id,
        lease_token,
        summary,
        model,
        was_compressed,
        response_payload,
        now=None,
    ):
        operation = self._owned_running_operation(operation_id, lease_token)
        now = now or datetime.now(timezone.utc)
        summary_id = uuid4()
        self.summaries[summary_id] = SimpleNamespace(
            id=summary_id,
            session_id=operation.session_id,
            raw=summary.model_dump(mode="json"),
            model=model,
            was_compressed=was_compressed,
            created_at=now,
        )
        session = self.sessions[operation.session_id]
        session.status = PracticeStatus.ANALYZED
        session.updated_at = now
        operation.status = OperationStatus.SUCCEEDED
        operation.response_payload = {
            **response_payload,
            "summary_id": str(summary_id),
        }
        operation.error_code = None
        operation.lease_token = None
        operation.lease_expires_at = None
        operation.updated_at = now
        return summary_id

    def fail_external_operation(
        self,
        *,
        operation_id,
        lease_token,
        error_code,
        fail_session=False,
        now=None,
    ):
        operation = self._owned_running_operation(operation_id, lease_token)
        now = now or datetime.now(timezone.utc)
        operation.status = OperationStatus.FAILED
        operation.error_code = error_code
        operation.response_payload = None
        operation.lease_token = None
        operation.lease_expires_at = None
        operation.updated_at = now
        if fail_session:
            session = self.sessions[operation.session_id]
            session.status = PracticeStatus.FAILED
            session.updated_at = now
        return True

    def release_external_operation(
        self, *, operation_id, lease_token, now=None
    ):
        operation = self._owned_running_operation(operation_id, lease_token)
        operation.status = OperationStatus.PENDING
        operation.error_code = None
        operation.response_payload = None
        operation.lease_token = None
        operation.lease_expires_at = None
        operation.updated_at = now or datetime.now(timezone.utc)
        return True

    def sweep_max_attempts_operations(self, *, now=None, max_attempts=3):
        now = now or datetime.now(timezone.utc)
        count = 0
        for operation in self.operations.values():
            if (
                operation.status
                in {
                    OperationStatus.PENDING,
                    OperationStatus.RUNNING,
                    OperationStatus.FAILED,
                }
                and operation.attempt_count >= max_attempts
                and operation.error_code != "max_attempts_exceeded"
                and (
                    operation.lease_token is None
                    or operation.lease_expires_at < now
                )
            ):
                operation.status = OperationStatus.FAILED
                operation.error_code = "max_attempts_exceeded"
                operation.lease_token = None
                operation.lease_expires_at = None
                session = self.sessions[operation.session_id]
                if session.status == PracticeStatus.ANALYZING:
                    session.status = PracticeStatus.FAILED
                count += 1
        return count

    def _create_operation(
        self,
        *,
        user_id,
        session_id,
        request_id,
        request_fingerprint,
        kind=OperationKind.ANALYZE,
    ):
        now = datetime.now(timezone.utc)
        operation = SimpleNamespace(
            id=uuid4(),
            session_id=session_id,
            user_id=user_id,
            request_id=request_id,
            kind=OperationKind(kind),
            status=OperationStatus.PENDING,
            attempt_count=0,
            request_fingerprint=request_fingerprint,
            lease_token=None,
            lease_expires_at=None,
            error_code=None,
            response_payload=None,
            created_at=now,
            updated_at=now,
        )
        self.operations[operation.id] = operation
        self.operation_requests[(user_id, request_id)] = operation.id
        return operation

    def _operation_by_request(self, user_id, request_id):
        operation_id = self.operation_requests.get((user_id, request_id))
        return self.operations.get(operation_id)

    def _owned_running_operation(self, operation_id, lease_token):
        operation = self.operations.get(operation_id)
        if (
            operation is None
            or operation.status != OperationStatus.RUNNING
            or operation.lease_token != lease_token
        ):
            raise LeaseOwnershipError("external operation lease is not owned")
        return operation

    def seed_summary(self, *, user_id, summary=SUMMARY, subtext=SUBTEXT):
        now = datetime.now(timezone.utc)
        practice_session_id = uuid4()
        summary_id = uuid4()
        self.sessions[practice_session_id] = SimpleNamespace(
            id=practice_session_id,
            user_id=user_id,
            upload_intent_id=uuid4(),
            status=PracticeStatus.ANALYZED,
            situation=subtext.situation,
            character_context=subtext.character,
            subtext=subtext.subtext,
            hidden_at=None,
            created_at=now,
            updated_at=now,
        )
        self.summaries[summary_id] = SimpleNamespace(
            id=summary_id,
            session_id=practice_session_id,
            raw=summary.model_dump(mode="json"),
            created_at=now,
        )
        return summary_id

    def get_owned_summary(self, *, user_id, summary_id):
        summary = self.summaries.get(summary_id)
        if summary is None:
            return None
        practice = self.sessions[summary.session_id]
        if practice.user_id != user_id or practice.hidden_at is not None:
            return None
        return SimpleNamespace(
            practice_session_id=practice.id,
            summary=AgentSceneSummary.model_validate(summary.raw),
            subtext=AgentSubText(
                situation=practice.situation,
                character=practice.character_context,
                subtext=practice.subtext,
            ),
        )

    def get_owned_coach_session(self, *, user_id, coach_session_id):
        session = self.coach_sessions.get(str(coach_session_id))
        if session is None:
            return None
        summary = self.summaries[UUID(session.summary_id)]
        practice = self.sessions[summary.session_id]
        if practice.user_id != user_id or practice.hidden_at is not None:
            return None
        return SimpleNamespace(
            practice_session_id=practice.id,
            session=session.model_copy(deep=True),
        )

    def get_owned_report_context(self, *, user_id, coach_session_id):
        owned = self.get_owned_coach_session(
            user_id=user_id,
            coach_session_id=coach_session_id,
        )
        if owned is None:
            return None
        session = owned.session
        summary = self.summaries[UUID(session.summary_id)]
        practice = self.sessions[summary.session_id]
        return SimpleNamespace(
            practice_session_id=practice.id,
            session=ReportCoachSession(
                session_id=session.session_id,
                summary=ReportSceneSummary.model_validate(summary.raw),
                subtext=ReportSubText(
                    situation=practice.situation,
                    character=practice.character_context,
                    subtext=practice.subtext,
                ),
                turns=[
                    ReportCoachTurn(role=turn.role, text=turn.text)
                    for turn in session.turns
                ],
                question_count=session.question_count,
                status=session.status,
                close_reason=session.close_reason,
            ),
        )

    def complete_coach_start_operation(
        self,
        *,
        operation_id,
        lease_token,
        coach_session,
        response_payload,
        now=None,
    ):
        return self._complete_coach_operation(
            operation_id=operation_id,
            lease_token=lease_token,
            coach_session=coach_session,
            response_payload=response_payload,
            now=now,
        )

    def complete_coach_reply_operation(
        self,
        *,
        operation_id,
        lease_token,
        coach_session,
        response_payload,
        now=None,
    ):
        return self._complete_coach_operation(
            operation_id=operation_id,
            lease_token=lease_token,
            coach_session=coach_session,
            response_payload=response_payload,
            now=now,
        )

    def _complete_coach_operation(
        self,
        *,
        operation_id,
        lease_token,
        coach_session,
        response_payload,
        now,
    ):
        operation = self._owned_running_operation(operation_id, lease_token)
        self.coach_sessions[coach_session.session_id] = coach_session.model_copy(
            deep=True
        )
        self._succeed(operation, response_payload, now)
        return True

    def complete_report_operation(
        self,
        *,
        operation_id,
        lease_token,
        coach_session_id,
        report,
        now=None,
    ):
        operation = self._owned_running_operation(operation_id, lease_token)
        session_id = str(coach_session_id)
        context = self.get_owned_report_context(
            user_id=operation.user_id,
            coach_session_id=coach_session_id,
        )
        if self.has_report_for_practice_session(context.practice_session_id):
            return None
        created_at = now or datetime.now(timezone.utc)
        self.reports[session_id] = ReportRecord(
            created_at=created_at.isoformat(),
            session_id=session_id,
            practice_session_id=str(context.practice_session_id),
            report=report,
        )
        payload = {
            "report": report.model_dump(mode="json"),
            "report_count": len(self.list_reports(operation.user_id)),
        }
        self._succeed(operation, payload, now)
        return payload

    def has_report_for_practice_session(self, practice_session_id: UUID):
        return any(
            self.summaries[
                UUID(self.coach_sessions[coach_session_id].summary_id)
            ].session_id
            == practice_session_id
            for coach_session_id in self.reports
        )

    def list_reports(self, user_id: UUID):
        return [
            record.model_copy(deep=True)
            for session_id, record in self.reports.items()
            if self._coach_owner(session_id) == user_id
            and self._report_practice(session_id).hidden_at is None
        ]

    def list_report_summaries(self, user_id: UUID):
        records = [
            SimpleNamespace(
                practice_session_id=UUID(record.practice_session_id),
                headline=record.report.headline,
                created_at=datetime.fromisoformat(record.created_at),
            )
            for session_id, record in self.reports.items()
            if self._coach_owner(session_id) == user_id
            and self._report_practice(session_id).hidden_at is None
        ]
        return sorted(
            records,
            key=lambda record: (record.created_at, record.practice_session_id),
        )

    def get_report_detail_for_practice_session(
        self, *, user_id: UUID, practice_session_id: UUID
    ):
        practice = self.get_practice_session(
            user_id=user_id,
            session_id=practice_session_id,
        )
        if practice is None:
            return None
        candidates = [
            record
            for record in self.reports.values()
            if UUID(record.practice_session_id) == practice_session_id
        ]
        if not candidates:
            return None
        latest = max(
            candidates,
            key=lambda record: (
                datetime.fromisoformat(record.created_at),
                record.session_id,
            ),
        )
        return SimpleNamespace(
            practice_session_id=practice_session_id,
            created_at=datetime.fromisoformat(latest.created_at),
            report=latest.report.model_copy(deep=True),
            object_key=self.uploads[practice.upload_intent_id].object_key,
        )

    def _coach_owner(self, coach_session_id: str):
        return self._report_practice(coach_session_id).user_id

    def _report_practice(self, coach_session_id: str):
        session = self.coach_sessions[coach_session_id]
        summary = self.summaries[UUID(session.summary_id)]
        return self.sessions[summary.session_id]

    @staticmethod
    def _succeed(operation, payload, now=None):
        operation.status = OperationStatus.SUCCEEDED
        operation.response_payload = payload
        operation.error_code = None
        operation.lease_token = None
        operation.lease_expires_at = None
        operation.updated_at = now or datetime.now(timezone.utc)


def finalized_upload(
    store, user_id, *, content_size=12, suffix=None, etag='"test-etag"'
):
    now = datetime.now(timezone.utc)
    suffix = suffix or uuid4().hex
    upload = store.create_upload_intent(
        user_id=user_id,
        storage_provider="s3",
        object_key=f"users/{user_id}/uploads/{suffix}.mp4",
        mime_type="video/mp4",
        size_bytes=content_size,
        duration_ms=1000,
        expires_at=now + timedelta(minutes=30),
    )
    store.finalize_upload_intent(
        user_id=user_id,
        upload_intent_id=upload.id,
        etag=etag,
        now=now,
    )
    return upload
