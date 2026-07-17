import asyncio
from datetime import timedelta
import os
import time
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI
from google import genai

from acting_agent.config import load_settings as load_agent_settings
from acting_api.analysis_worker import (
    AnalysisWorker,
    AnalysisWorkerPool,
    SummaryAnalyzer,
)
from acting_api.auth.dependencies import (
    build_current_user_dependency,
    build_rate_limited_user_dependency,
)
from acting_api.auth.google import GoogleProviderVerifier
from acting_api.auth.jwt import JwtService
from acting_api.auth.providers import ProviderRegistry
from acting_api.auth.router import build_router as build_auth_router
from acting_api.coaching import build_router as build_coaching_router
from acting_api.config import load_gateway_settings
from acting_api.consents import build_router as build_consents_router
from acting_api.db.store import PostgresStore
from acting_api.keepalive import keep_alive_loop
from acting_api.practice_sessions import build_router as build_practice_router
from acting_api.ratelimit import RateLimiter
from acting_api.reports import build_router as build_reports_router
from acting_api.storage import S3Storage
from acting_api.uploads import build_router as build_uploads_router
from acting_report.config import load_settings as load_report_settings
from acting_summary.config import load_settings as load_summary_settings


def create_app(
    *,
    client=None,
    gateway_settings=None,
    summary_settings=None,
    agent_settings=None,
    report_settings=None,
    store=None,
    clock=time.monotonic,
    keep_alive_client=None,
    jwt_service=None,
    provider_registry=None,
    s3_client=None,
    s3_storage=None,
    analysis_worker=None,
    analyzer=None,
) -> FastAPI:
    gateway_settings = gateway_settings or load_gateway_settings()
    summary_settings = summary_settings or load_summary_settings()
    agent_settings = agent_settings or load_agent_settings()
    report_settings = report_settings or load_report_settings()
    client = client or genai.Client(api_key=summary_settings.api_key)
    owns_store = store is None
    if store is None:
        store = PostgresStore.from_url(gateway_settings.database_url)
    limiter = RateLimiter(clock=clock)
    jwt_service = jwt_service or JwtService(gateway_settings.jwt_secret)
    provider_registry = provider_registry or ProviderRegistry(
        [GoogleProviderVerifier(gateway_settings.google_oauth_client_id)]
    )
    current_user = build_current_user_dependency(store, jwt_service)
    rate_limited_user = build_rate_limited_user_dependency(current_user, limiter)
    if s3_storage is None and gateway_settings.s3_configured:
        if s3_client is not None:
            s3_storage = S3Storage(bucket=gateway_settings.s3_bucket, client=s3_client)
        else:
            s3_storage = S3Storage.from_credentials(
                bucket=gateway_settings.s3_bucket,
                access_key_id=gateway_settings.aws_access_key_id,
                secret_access_key=gateway_settings.aws_secret_access_key,
                region=gateway_settings.aws_region,
            )
    if (
        analysis_worker is None
        and s3_storage is not None
        and isinstance(store, PostgresStore)
    ):
        analyzer = analyzer or SummaryAnalyzer(
            client=client,
            model=summary_settings.model,
        )
        analysis_worker = AnalysisWorkerPool(
            worker=AnalysisWorker(
                store=store,
                storage=s3_storage,
                analyzer=analyzer,
                lease_duration=timedelta(seconds=gateway_settings.analysis_lease_sec),
                model=summary_settings.model,
            ),
            concurrency=gateway_settings.analysis_worker_concurrency,
            poll_interval_sec=gateway_settings.analysis_worker_poll_interval_sec,
            sweep_interval_sec=gateway_settings.analysis_sweep_interval_sec,
        )

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        task = None
        owned_client = None
        if gateway_settings.keep_alive_url:
            ping_client = keep_alive_client
            if ping_client is None:
                ping_client = owned_client = httpx.AsyncClient(timeout=30)
            task = asyncio.create_task(
                keep_alive_loop(
                    gateway_settings.keep_alive_url,
                    gateway_settings.keep_alive_interval_sec,
                    ping_client,
                )
            )
        app.state.keep_alive_task = task
        if analysis_worker is not None:
            analysis_worker.start()
        try:
            yield
        finally:
            if analysis_worker is not None:
                analysis_worker.stop()
            if task:
                task.cancel()
            if owned_client:
                await owned_client.aclose()
            if owns_store:
                store.close()

    app = FastAPI(
        title="acting-api",
        description="연기 분석 플랫폼 API v2. Bearer access token을 사용합니다.",
        lifespan=lifespan,
    )
    app.state.store = store
    app.state.s3_storage = s3_storage
    app.state.analysis_worker = analysis_worker

    @app.get("/health")
    def health():
        return {
            "status": "ok",
            "services": ["summary", "coach", "report"],
            "model": summary_settings.model,
            "keep_alive": bool(gateway_settings.keep_alive_url),
            # 이전 배포 환경 변수가 있으면 진단 메타데이터로 계속 노출한다.
            "commit": os.environ.get("RENDER_GIT_COMMIT", "unknown")[:7],
        }

    app.include_router(
        build_auth_router(
            store=store,
            jwt_service=jwt_service,
            providers=provider_registry,
            current_user=current_user,
            user_limiter=limiter,
        )
    )
    app.include_router(
        build_consents_router(
            store=store,
            rate_limited_user=rate_limited_user,
        )
    )
    app.include_router(
        build_uploads_router(
            store=store,
            storage=s3_storage,
            rate_limited_user=rate_limited_user,
        )
    )
    app.include_router(
        build_practice_router(
            store=store,
            storage=s3_storage,
            rate_limited_user=rate_limited_user,
        )
    )
    app.include_router(
        build_coaching_router(
            client=client,
            settings=agent_settings,
            store=store,
            rate_limited_user=rate_limited_user,
        )
    )
    app.include_router(
        build_reports_router(
            client=client,
            settings=report_settings,
            store=store,
            rate_limited_user=rate_limited_user,
        )
    )

    return app
