import asyncio
import os
import time
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, Security
from fastapi.responses import JSONResponse
from fastapi.security import APIKeyHeader
from google import genai
from starlette.concurrency import run_in_threadpool

from acting_agent.config import load_settings as load_agent_settings
from acting_agent.router import build_router as build_coach_router
from acting_api.config import load_gateway_settings
from acting_api.db.store import PostgresStore
from acting_api.keepalive import keep_alive_loop
from acting_api.ratelimit import RateLimiter
from acting_api.security import hash_api_key
from acting_report.config import load_settings as load_report_settings
from acting_report.router import build_router as build_report_router
from acting_summary.config import load_settings as load_summary_settings
from acting_summary.router import build_router as build_summary_router

EXEMPT_PATHS = {"/health", "/docs", "/openapi.json", "/redoc"}

# Swagger UI Authorize 버튼용 스펙 선언 — 실제 검증은 미들웨어가 담당
api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)


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
        try:
            yield
        finally:
            if task:
                task.cancel()
            if owned_client:
                await owned_client.aclose()
            if owns_store:
                store.close()

    app = FastAPI(
        title="acting-api",
        description="연기 영상 요약(/summarize) → 코치 대화(/coach/*) → 진단 리포트(/report) 통합 API. 모든 요청에 X-API-Key 헤더 필요.",
        dependencies=[Security(api_key_header)],
        lifespan=lifespan,
    )
    app.state.store = store

    @app.middleware("http")
    async def auth_and_rate_limit(request, call_next):
        if request.url.path in EXEMPT_PATHS:
            return await call_next(request)
        key = request.headers.get("X-API-Key")
        if key is None:
            return JSONResponse(
                status_code=401, content={"detail": "invalid or missing X-API-Key"}
            )
        key_hash = hash_api_key(key)
        rate_limit = await run_in_threadpool(store.get_api_key_rate_limit, key_hash)
        if rate_limit is None:
            return JSONResponse(
                status_code=401, content={"detail": "invalid or missing X-API-Key"}
            )
        if not limiter.allow(key_hash, rate_limit):
            return JSONResponse(
                status_code=429, content={"detail": "rate limit exceeded"}
            )
        return await call_next(request)

    @app.get("/health")
    def health():
        return {
            "status": "ok",
            "services": ["summary", "coach", "report"],
            "model": summary_settings.model,
            "keep_alive": bool(gateway_settings.keep_alive_url),
            # Render가 주입하는 배포 커밋 — 어느 버전이 라이브인지 확인용
            "commit": os.environ.get("RENDER_GIT_COMMIT", "unknown")[:7],
        }

    app.include_router(
        build_summary_router(client=client, settings=summary_settings, store=store)
    )
    app.include_router(
        build_coach_router(client=client, settings=agent_settings, store=store)
    )
    app.include_router(
        build_report_router(client=client, settings=report_settings, store=store)
    )

    return app
