"""`create_app(...)` 을 감싸는 얇은 ASGI 래퍼 + 제어 표면.

`apps/api` 소스는 건드리지 않는다(§백엔드 adapter 계약 ②). 제어 라우트는 래퍼가
가지고 있고 FastAPI 앱에는 붙지 않는다 — `app.openapi()` 가 오염되지 않아야 한다.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from sqlalchemy import text

from acting_api.analysis_worker import AnalysisWorker
from acting_api.app import create_app
from acting_api.auth.jwt import JwtService
from acting_api.auth.providers import ProviderRegistry
from acting_api.config import GatewaySettings
from acting_api.db.community_store import CommunityStore
from acting_api.db.store import PostgresStore
from acting_summary.config import Settings as SummarySettings

from contract_harness import config as cfg
from contract_harness.stubs import (
    LLM_FIXTURE,
    AnalyzerStub,
    HarnessClock,
    ProviderVerifierStub,
    StorageStub,
    TextGeneratorStub,
    WorkerPoolStub,
    AUTH_FIXTURE,
)

ANALYSIS_LEASE = timedelta(seconds=1800)


class BackendRuntime:
    """앱 하나와 그 앱을 조종하는 손잡이들."""

    def __init__(self, *, database_url: str, schema: str, profile: str) -> None:
        from contract_harness.dbsetup import scoped_url

        self.profile = profile
        self.scoped_url = scoped_url(database_url, schema)
        self.schema = schema
        self.clock = HarnessClock()
        self.store = PostgresStore.from_url(self.scoped_url)
        self.community_store = CommunityStore.from_store(self.store)
        self.storage = StorageStub()
        self.analyzer = AnalyzerStub()
        self.coach_generate = TextGeneratorStub(LLM_FIXTURE["coach"], "coach_generate")
        self.report_generate = TextGeneratorStub(
            LLM_FIXTURE["report"], "report_generate"
        )
        self.worker = AnalysisWorker(
            store=self.store,
            storage=self.storage,
            analyzer=self.analyzer,
            lease_duration=ANALYSIS_LEASE,
            model=cfg.SUMMARY_MODEL,
        )
        self.worker_pool = WorkerPoolStub(self.worker)
        self.jwt_service = JwtService(cfg.JWT_SECRET)
        self.app = self._build_app()

    # -- 앱 조립 ----------------------------------------------------------

    def _build_app(self):
        previous_admin = os.environ.get("ADMIN_OPS_TOKEN")
        if self.profile == "admin":
            os.environ["ADMIN_OPS_TOKEN"] = cfg.ADMIN_OPS_TOKEN
        else:
            os.environ.pop("ADMIN_OPS_TOKEN", None)
        # `nostorage` 프로파일은 S3 를 아예 주입하지 않는다 — 503 storage_not_configured
        # 분기가 그 상태에서만 도달 가능하기 때문이다.
        storage = None if self.profile == "nostorage" else self.storage
        try:
            return create_app(
                client=SimpleNamespace(models=SimpleNamespace()),
                gateway_settings=GatewaySettings(
                    database_url=self.scoped_url,
                    jwt_secret=cfg.JWT_SECRET,
                    s3_bucket=None if storage is None else cfg.S3_BUCKET,
                    aws_region=None if storage is None else cfg.AWS_REGION,
                ),
                summary_settings=SummarySettings(
                    api_key="harness", model=cfg.SUMMARY_MODEL
                ),
                store=self.store,
                community_store=self.community_store,
                clock=self.clock.monotonic,
                jwt_service=self.jwt_service,
                provider_registry=ProviderRegistry(
                    [
                        ProviderVerifierStub(name)
                        for name in AUTH_FIXTURE["providers"]
                    ]
                ),
                s3_storage=storage,
                analysis_worker=self.worker_pool,
                analyzer=self.analyzer,
                coach_generate=self.coach_generate,
                report_generate=self.report_generate,
            )
        finally:
            if previous_admin is None:
                os.environ.pop("ADMIN_OPS_TOKEN", None)
            else:
                os.environ["ADMIN_OPS_TOKEN"] = previous_admin

    def close(self) -> None:
        self.store.close()

    # -- 제어 표면 --------------------------------------------------------

    def now(self) -> datetime:
        return datetime.now(timezone.utc) + timedelta(seconds=self.clock.offset)

    def control(self, name: str, payload: dict) -> dict:
        if name == "run-worker-once":
            worked = self.worker.run_once(now=self.now())
            return {"processed": 1 if worked else 0}
        if name == "run-sweep":
            expired, exhausted = self.worker.sweep(now=self.now())
            return {"expired_uploads": expired, "exhausted_operations": exhausted}
        if name == "stub-state":
            # 읽기 전용이 기본이고, `release`/`rearm` 이 오면 멈춰 있는 스텁을 푼다.
            # 별도 release/rearm 제어를 늘리지 않으려고 기존 제어의 payload 로 넣었다 —
            # 스텁 게이트는 스텁 상태의 일부다.
            for stub in (self.coach_generate, self.report_generate):
                if payload.get("release"):
                    stub.release()
                if payload.get("rearm"):
                    stub.rearm()
            return {
                "coach_generate": self.coach_generate.state(),
                "report_generate": self.report_generate.state(),
                "analyzer": self.analyzer.state(),
                "s3": self.storage.state(),
            }
        if name == "advance-clock":
            seconds = float(payload.get("seconds", 0))
            return {"offset_sec": self.clock.advance(seconds)}
        if name == "db-projection":
            return self.db_projection(payload.get("include"))
        if name == "reset-state":
            self.clock.reset()
            return {"reset": True}
        raise KeyError(name)

    # -- DB projection ----------------------------------------------------

    def db_projection(self, include=None) -> dict:
        include = set(include or cfg_default_projection())
        now = self.now()
        out: dict = {}
        with self.store.engine.connect() as connection:
            if "external_operations" in include:
                out["external_operations"] = [
                    {
                        "request_id": str(row.request_id),
                        "kind": row.kind,
                        "status": row.status,
                        "attempt_count": row.attempt_count,
                        "error_code": row.error_code,
                        "has_lease_token": row.has_lease_token,
                        "lease_expired": (
                            None
                            if row.lease_expires_at is None
                            else row.lease_expires_at <= now
                        ),
                        "practice_session_id": (
                            None if row.session_id is None else str(row.session_id)
                        ),
                        "has_response_payload": row.has_response_payload,
                    }
                    for row in connection.execute(
                        text(
                            "SELECT request_id, kind::text AS kind,"
                            " status::text AS status, attempt_count, error_code,"
                            " (lease_token IS NOT NULL) AS has_lease_token,"
                            " lease_expires_at, session_id,"
                            " (response_payload IS NOT NULL) AS has_response_payload"
                            " FROM external_operations"
                            " ORDER BY request_id, kind::text"
                        )
                    )
                ]
            if "coach_sessions" in include:
                out["coach_sessions"] = [
                    {
                        "id": str(row.id),
                        "status": row.status,
                        "close_reason": row.close_reason,
                        "practice_session_id": str(row.practice_session_id),
                        "turn_count": row.turn_count,
                    }
                    for row in connection.execute(
                        text(
                            "SELECT s.id, s.status::text AS status,"
                            " s.close_reason::text AS close_reason,"
                            " s.practice_session_id,"
                            " (SELECT count(*) FROM coach_turns t"
                            "  WHERE t.session_id = s.id) AS turn_count"
                            " FROM coach_sessions s"
                            " ORDER BY s.created_at, s.id"
                        )
                    )
                ]
            if "refresh_tokens" in include:
                out["refresh_tokens"] = [
                    {
                        "index": index,
                        "user_id": str(row.user_id),
                        "revoked": row.revoked,
                        "has_replacement": row.replaced_by_id is not None,
                    }
                    for index, row in enumerate(
                        connection.execute(
                            text(
                                "SELECT user_id, replaced_by_id,"
                                " (revoked_at IS NOT NULL) AS revoked"
                                " FROM refresh_tokens"
                                " ORDER BY issued_at, id"
                            )
                        )
                    )
                ]
            if "practice_sessions" in include:
                out["practice_sessions"] = [
                    {"id": str(row.id), "status": row.status}
                    for row in connection.execute(
                        text(
                            "SELECT id, status::text AS status FROM practice_sessions"
                            " ORDER BY created_at, id"
                        )
                    )
                ]
            if "practice_reports" in include:
                out["practice_reports"] = [
                    {
                        "practice_session_id": str(row.practice_session_id),
                        "report_type": row.report_type,
                    }
                    for row in connection.execute(
                        text(
                            "SELECT practice_session_id,"
                            " report_type::text AS report_type"
                            " FROM practice_reports ORDER BY created_at"
                        )
                    )
                ]
        return out


def cfg_default_projection() -> tuple[str, ...]:
    return (
        "external_operations",
        "coach_sessions",
        "refresh_tokens",
        "practice_sessions",
        "practice_reports",
    )


# --- ASGI 래퍼 ------------------------------------------------------------


class HarnessASGI:
    """제어 라우트를 앞에 두고 나머지는 원본 앱에 그대로 넘긴다."""

    def __init__(self, runtime: BackendRuntime, response_mutation=None) -> None:
        self.runtime = runtime
        self.inner = runtime.app
        self.response_mutation = response_mutation

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and scope["path"].startswith(cfg.CONTROL_PREFIX):
            await self._control(scope, receive, send)
            return
        if self.response_mutation is None:
            await self.inner(scope, receive, send)
            return
        await self._mutating(scope, receive, send)

    async def _control(self, scope, receive, send):
        name = scope["path"][len(cfg.CONTROL_PREFIX) :].lstrip("/")
        body = b""
        while True:
            message = await receive()
            body += message.get("body", b"")
            if not message.get("more_body"):
                break
        payload = json.loads(body) if body else {}
        try:
            result = self.runtime.control(name, payload)
            status = 200
        except KeyError:
            result = {"detail": f"unknown control: {name}"}
            status = 404
        encoded = json.dumps(result, ensure_ascii=False, default=str).encode()
        await send(
            {
                "type": "http.response.start",
                "status": status,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"content-length", str(len(encoded)).encode()),
                ],
            }
        )
        await send({"type": "http.response.body", "body": encoded})

    async def _mutating(self, scope, receive, send):
        chunks: list[bytes] = []
        start_message: dict = {}

        async def capture(message):
            if message["type"] == "http.response.start":
                start_message.update(message)
                return
            if message["type"] == "http.response.body":
                chunks.append(message.get("body", b""))
                if message.get("more_body"):
                    return
                await self._emit(scope, start_message, b"".join(chunks), send)
                return
            await send(message)

        await self.inner(scope, receive, capture)

    async def _emit(self, scope, start_message, body, send):
        headers = [
            (key.decode("latin-1"), value.decode("latin-1"))
            for key, value in start_message.get("headers", [])
        ]
        status = start_message.get("status", 200)
        status, headers, body = self.response_mutation(scope, status, headers, body)
        encoded_headers = [
            (key.encode("latin-1"), value.encode("latin-1"))
            for key, value in headers
            if key.lower() != "content-length"
        ]
        encoded_headers.append((b"content-length", str(len(body)).encode()))
        await send(
            {
                "type": "http.response.start",
                "status": status,
                "headers": encoded_headers,
            }
        )
        await send({"type": "http.response.body", "body": body})
