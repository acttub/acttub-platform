import secrets
import time

from fastapi import FastAPI, Security
from fastapi.responses import JSONResponse
from fastapi.security import APIKeyHeader
from google import genai

from acting_agent.config import load_settings as load_agent_settings
from acting_agent.router import build_router as build_coach_router
from acting_api.config import load_gateway_settings
from acting_api.ratelimit import RateLimiter
from acting_report.config import load_settings as load_report_settings
from acting_report.router import build_router as build_report_router
from acting_report.store import FileReportStore
from acting_summary.config import load_settings as load_summary_settings
from acting_summary.router import build_router as build_summary_router

EXEMPT_PATHS = {"/health", "/docs", "/openapi.json", "/redoc"}

# Swagger UI Authorize 버튼용 스펙 선언 — 실제 검증은 미들웨어가 담당
api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)


def _key_valid(key: str | None, api_keys: tuple[str, ...]) -> bool:
    if key is None:
        return False
    return any(secrets.compare_digest(key, k) for k in api_keys)


def create_app(
    *,
    client=None,
    gateway_settings=None,
    summary_settings=None,
    agent_settings=None,
    report_settings=None,
    report_store=None,
    clock=time.monotonic,
) -> FastAPI:
    gateway_settings = gateway_settings or load_gateway_settings()
    summary_settings = summary_settings or load_summary_settings()
    agent_settings = agent_settings or load_agent_settings()
    report_settings = report_settings or load_report_settings()
    client = client or genai.Client(api_key=summary_settings.api_key)
    report_store = report_store or FileReportStore(report_settings.store_path)
    limiter = RateLimiter(gateway_settings.rate_limit_per_min, clock=clock)

    app = FastAPI(
        title="acting-api",
        description="연기 영상 요약(/summarize) → 코치 대화(/coach/*) → 진단 리포트(/report) 통합 API. 모든 요청에 X-API-Key 헤더 필요.",
        dependencies=[Security(api_key_header)],
    )

    @app.middleware("http")
    async def auth_and_rate_limit(request, call_next):
        if request.url.path in EXEMPT_PATHS:
            return await call_next(request)
        if not gateway_settings.api_keys:
            return JSONResponse(
                status_code=503, content={"detail": "API_KEYS not configured"}
            )
        key = request.headers.get("X-API-Key")
        if not _key_valid(key, gateway_settings.api_keys):
            return JSONResponse(
                status_code=401, content={"detail": "invalid or missing X-API-Key"}
            )
        if not limiter.allow(key):
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
        }

    app.include_router(build_summary_router(client=client, settings=summary_settings))
    app.include_router(build_coach_router(client=client, settings=agent_settings))
    app.include_router(
        build_report_router(client=client, settings=report_settings, store=report_store)
    )

    return app
