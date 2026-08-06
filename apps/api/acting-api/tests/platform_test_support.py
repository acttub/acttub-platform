from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import UUID, uuid4

from acting_agent.schema import CoachSession as AgentCoachSession
from acting_agent.summary_schema import ActorMaterial as AgentActorMaterial
from acting_agent.summary_schema import ObservationPack as AgentObservationPack
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
        self.transcripts = {}
        self.coach_sessions: dict[str, AgentCoachSession] = {}
        self.handoffs = {}
        self.confirmations = {}
        self.practice_reports = {}

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
        goal,
        blockage_kind="그 외",
        sub_branch="그 외",
        blockage_detail=None,
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
        now = datetime.now(timezone.utc)
        session = SimpleNamespace(
            id=uuid4(),
            user_id=user_id,
            upload_intent_id=upload_intent_id,
            status=PracticeStatus.ANALYZING,
            situation=situation,
            character_context=character_context,
            goal=goal,
            subtext=None,
            blockage_kind=blockage_kind,
            sub_branch=sub_branch,
            blockage_detail=blockage_detail,
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

    def get_practice_session_status(self, *, user_id, session_id):
        session = self.get_practice_session(user_id=user_id, session_id=session_id)
        if session is None:
            return None
        error_code = None
        if session.status == PracticeStatus.FAILED:
            operations = [
                row
                for row in self.operations.values()
                if row.session_id == session.id and row.kind == OperationKind.ANALYZE
            ]
            latest = max(
                operations,
                key=lambda row: (row.created_at, row.id),
                default=None,
            )
            error_code = latest.error_code if latest is not None else None
        return SimpleNamespace(status=session.status, error_code=error_code)

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
        observation_pack,
        model,
        was_compressed,
        response_payload,
        transcripts=(),
        now=None,
    ):
        operation = self._owned_running_operation(operation_id, lease_token)
        now = now or datetime.now(timezone.utc)
        summary_id = uuid4()
        self.summaries[summary_id] = SimpleNamespace(
            id=summary_id,
            session_id=operation.session_id,
            raw=observation_pack.model_dump(mode="json"),
            observations_json=observation_pack.model_dump(mode="json")["observations"],
            uncertainties_json=observation_pack.model_dump(mode="json")["uncertainties"],
            model=model,
            was_compressed=was_compressed,
            created_at=now,
        )
        self.transcripts[operation.session_id] = list(transcripts)
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

    def seed_summary(
        self,
        *,
        user_id,
        summary=SUMMARY,
        actor=SUBTEXT,
        blockage_kind="분석",
        sub_branch="대사 분석",
        blockage_detail="왜 지금 말하는지 모르겠어.",
        transcripts=(),
    ):
        now = datetime.now(timezone.utc)
        practice_session_id = uuid4()
        summary_id = uuid4()
        upload_intent_id = uuid4()
        self.uploads[upload_intent_id] = SimpleNamespace(
            id=upload_intent_id,
            user_id=user_id,
            status=UploadStatus.FINALIZED,
            object_key=f"users/{user_id}/uploads/seed.mp4",
            duration_ms=actor.duration_ms,
        )
        self.sessions[practice_session_id] = SimpleNamespace(
            id=practice_session_id,
            user_id=user_id,
            upload_intent_id=upload_intent_id,
            status=PracticeStatus.ANALYZED,
            situation=actor.situation,
            character_context=actor.character,
            goal=actor.goal,
            subtext=None,
            blockage_kind=blockage_kind,
            sub_branch=sub_branch,
            blockage_detail=blockage_detail,
            hidden_at=None,
            created_at=now,
            updated_at=now,
        )
        self.summaries[summary_id] = SimpleNamespace(
            id=summary_id,
            session_id=practice_session_id,
            raw=summary.model_dump(mode="json"),
            observations_json=summary.model_dump(mode="json")["observations"],
            uncertainties_json=summary.model_dump(mode="json")["uncertainties"],
            created_at=now,
        )
        self.transcripts[practice_session_id] = list(transcripts)
        return summary_id

    def get_owned_practice_session_context(
        self, *, user_id, practice_session_id
    ):
        practice = self.sessions.get(practice_session_id)
        if practice is None:
            return None
        if practice.user_id != user_id or practice.hidden_at is not None:
            return None
        summary = next(
            (
                row
                for row in self.summaries.values()
                if row.session_id == practice.id
            ),
            None,
        )
        upload = self.uploads[practice.upload_intent_id]
        return SimpleNamespace(
            practice_session_id=practice.id,
            summary_id=summary.id if summary is not None else None,
            observation_pack=(
                AgentObservationPack.model_validate(summary.raw)
                if summary is not None
                else None
            ),
            actor=AgentActorMaterial(
                situation=practice.situation,
                character=practice.character_context,
                goal=practice.goal,
                blockage_kind=practice.blockage_kind,
                blockage_detail=practice.blockage_detail or "",
                duration_ms=upload.duration_ms or 0,
            ),
            sub_branch=practice.sub_branch,
            transcripts=tuple(self.transcripts.get(practice.id, ())),
            analysis_handoff=self._confirmed_analysis_handoff(
                user_id=user_id,
                upload_intent_id=practice.upload_intent_id,
            )
            if practice.blockage_kind == "표현"
            else None,
        )

    def _confirmed_analysis_handoff(self, *, user_id, upload_intent_id):
        handoff = max(
            (
                row
                for row in self.handoffs.values()
                if row.branch_kind == "analysis"
                and self.confirmations.get(
                    row.id, SimpleNamespace(confirmed=False)
                ).confirmed
                and self.sessions[row.practice_session_id].user_id == user_id
                and self.sessions[row.practice_session_id].upload_intent_id
                == upload_intent_id
            ),
            key=lambda row: (row.created_at, row.id),
            default=None,
        )
        return handoff.handoff_json if handoff is not None else None

    def get_owned_coach_session(self, *, user_id, coach_session_id):
        session = self.coach_sessions.get(str(coach_session_id))
        if session is None:
            return None
        practice = self.sessions[UUID(session.practice_session_id)]
        if practice.user_id != user_id or practice.hidden_at is not None:
            return None
        context = self.get_owned_practice_session_context(
            user_id=user_id,
            practice_session_id=practice.id,
        )
        refreshed = session.model_copy(
            update={
                "summary_id": (
                    str(context.summary_id) if context.summary_id is not None else None
                ),
                "observation_pack": context.observation_pack,
                "transcripts": list(context.transcripts),
                "analysis_handoff": context.analysis_handoff,
            },
            deep=True,
        )
        return SimpleNamespace(
            practice_session_id=practice.id,
            session=refreshed,
        )

    def get_oldest_open_coach_session(self, *, user_id, practice_session_id):
        for session in self.coach_sessions.values():
            if (
                session.practice_session_id == str(practice_session_id)
                and session.status == "open"
            ):
                return self.get_owned_coach_session(
                    user_id=user_id,
                    coach_session_id=UUID(session.session_id),
                )
        return None

    def get_owned_report_source(self, *, user_id, coach_session_id):
        owned = self.get_owned_coach_session(
            user_id=user_id,
            coach_session_id=coach_session_id,
        )
        if owned is None:
            return None
        session = owned.session
        practice = self.sessions[UUID(session.practice_session_id)]
        summary = next(
            (
                row
                for row in self.summaries.values()
                if row.session_id == practice.id
            ),
            None,
        )
        handoffs = [
            row
            for row in self.handoffs.values()
            if row.coach_session_id == str(coach_session_id)
        ]
        handoff = max(
            handoffs, key=lambda row: (row.created_at, row.id), default=None
        )
        branch_kind = (
            handoff.branch_kind
            if handoff is not None
            else ("expression" if practice.blockage_kind == "표현" else "analysis")
        )
        analysis = max(
            (
                row
                for row in self.handoffs.values()
                if row.branch_kind == "analysis"
                and self.confirmations.get(row.id, SimpleNamespace(confirmed=False)).confirmed
                and self.sessions[row.practice_session_id].user_id == user_id
                and self.sessions[row.practice_session_id].upload_intent_id
                == practice.upload_intent_id
            ),
            key=lambda row: (row.created_at, row.id),
            default=None,
        )
        return SimpleNamespace(
            practice_session_id=practice.id,
            coach_session_id=UUID(session.session_id),
            video_summary=(
                summary.raw
                if summary is not None
                else {"observations": [], "uncertainties": []}
            ),
            branch_kind=branch_kind,
            handoff_id=handoff.id if handoff is not None else None,
            handoff_json=handoff.handoff_json if handoff is not None else None,
            confirmed=(
                self.confirmations.get(handoff.id, SimpleNamespace(confirmed=False)).confirmed
                if handoff is not None
                else False
            ),
            analysis_handoff_id=analysis.id if analysis is not None else None,
            analysis_handoff_json=(
                analysis.handoff_json if analysis is not None else None
            ),
        )

    def complete_coach_start_operation(
        self,
        *,
        operation_id,
        lease_token,
        coach_session,
        response_payload,
        handoff_id=None,
        branch_kind=None,
        handoff_json=None,
        confirmed=False,
        report_json=None,
        restart=False,
        now=None,
    ):
        if restart:
            operation = self._owned_running_operation(operation_id, lease_token)
            for existing in self.coach_sessions.values():
                if (
                    existing.practice_session_id == str(operation.session_id)
                    and existing.status == "open"
                ):
                    existing.status = "closed"
        return self._complete_coach_operation(
            operation_id=operation_id,
            lease_token=lease_token,
            coach_session=coach_session,
            response_payload=response_payload,
            handoff_id=handoff_id,
            branch_kind=branch_kind,
            handoff_json=handoff_json,
            confirmed=confirmed,
            report_json=report_json,
            now=now,
        )

    def complete_coach_reply_operation(
        self,
        *,
        operation_id,
        lease_token,
        coach_session,
        response_payload,
        handoff_id=None,
        branch_kind=None,
        handoff_json=None,
        confirmed=False,
        report_json=None,
        now=None,
    ):
        return self._complete_coach_operation(
            operation_id=operation_id,
            lease_token=lease_token,
            coach_session=coach_session,
            response_payload=response_payload,
            handoff_id=handoff_id,
            branch_kind=branch_kind,
            handoff_json=handoff_json,
            confirmed=confirmed,
            report_json=report_json,
            now=now,
        )

    def _complete_coach_operation(
        self,
        *,
        operation_id,
        lease_token,
        coach_session,
        response_payload,
        handoff_id,
        branch_kind,
        handoff_json,
        confirmed,
        report_json,
        now,
    ):
        operation = self._owned_running_operation(operation_id, lease_token)
        stored_session = coach_session.model_copy(deep=True)
        if confirmed:
            stored_session.status = "closed"
        self.coach_sessions[coach_session.session_id] = stored_session
        if handoff_id is not None:
            self.handoffs[handoff_id] = SimpleNamespace(
                id=handoff_id,
                coach_session_id=coach_session.session_id,
                practice_session_id=operation.session_id,
                branch_kind=branch_kind,
                handoff_json=handoff_json,
                created_at=now or datetime.now(timezone.utc),
            )
            if confirmed:
                self.confirmations[handoff_id] = SimpleNamespace(
                    confirmed=True,
                    rebuttal_text=None,
                    updated_at=now or datetime.now(timezone.utc),
                )
            if report_json is not None and report_json["report_type"] != "blocked":
                self.practice_reports[handoff_id] = SimpleNamespace(
                    id=uuid4(),
                    practice_session_id=operation.session_id,
                    report_type=report_json["report_type"],
                    report_json=report_json.copy(),
                    source_handoff_id=handoff_id,
                    created_at=now or datetime.now(timezone.utc),
                )
        self._succeed(operation, response_payload, now)
        return True

    def confirm_latest_handoff(
        self,
        *,
        coach_session_id,
        user_id,
        confirmed,
        rebuttal_text,
        now=None,
    ):
        source = self.get_owned_report_source(
            user_id=user_id,
            coach_session_id=coach_session_id,
        )
        if source is None or source.handoff_id is None:
            return source
        self.confirmations[source.handoff_id] = SimpleNamespace(
            confirmed=confirmed,
            rebuttal_text=rebuttal_text,
            updated_at=now or datetime.now(timezone.utc),
        )
        if confirmed:
            self.coach_sessions[str(coach_session_id)].status = "closed"
        values = vars(source).copy()
        values["confirmed"] = confirmed
        return SimpleNamespace(**values)

    def complete_sync_operation(
        self, *, operation_id, lease_token, response_payload, now=None
    ):
        operation = self._owned_running_operation(operation_id, lease_token)
        self._succeed(operation, response_payload, now)
        return True

    def get_practice_report_for_handoff(self, source_handoff_id):
        row = self.practice_reports.get(source_handoff_id)
        return row.report_json.copy() if row is not None else None

    def complete_practice_report_operation(
        self,
        *,
        operation_id,
        lease_token,
        practice_session_id,
        report_type,
        report_json,
        source_handoff_id,
        response_payload,
        now=None,
    ):
        operation = self._owned_running_operation(operation_id, lease_token)
        if source_handoff_id in self.practice_reports:
            return False
        self.practice_reports[source_handoff_id] = SimpleNamespace(
            id=uuid4(),
            practice_session_id=practice_session_id,
            report_type=report_type,
            report_json=report_json.copy(),
            source_handoff_id=source_handoff_id,
            created_at=now or datetime.now(timezone.utc),
        )
        self._succeed(operation, response_payload, now)
        return True

    def has_report_for_practice_session(self, practice_session_id: UUID):
        return any(
            report.practice_session_id == practice_session_id
            for report in self.practice_reports.values()
        )

    def list_report_summaries(self, user_id: UUID):
        records = [
            SimpleNamespace(
                practice_session_id=record.practice_session_id,
                report_type=record.report_type,
                title=record.report_json["title"],
                created_at=record.created_at,
            )
            for record in self.practice_reports.values()
            if self.sessions[record.practice_session_id].user_id == user_id
            and self.sessions[record.practice_session_id].hidden_at is None
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
            for record in self.practice_reports.values()
            if record.practice_session_id == practice_session_id
        ]
        if not candidates:
            return None
        latest = max(
            candidates,
            key=lambda record: (
                record.created_at,
                record.id,
            ),
        )
        return SimpleNamespace(
            practice_session_id=practice_session_id,
            created_at=latest.created_at,
            report=latest.report_json.copy(),
            object_key=self.uploads[practice.upload_intent_id].object_key,
        )

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
