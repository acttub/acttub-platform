import asyncio
from datetime import timedelta
import logging
import os
import time
from contextlib import asynccontextmanager
from typing import Literal

import boto3
import httpx
from botocore.exceptions import (
    CredentialRetrievalError,
    MetadataRetrievalError,
    NoCredentialsError,
)
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from google import genai
from pydantic import BaseModel, ConfigDict
from starlette.concurrency import run_in_threadpool

from acting_agent.config import load_settings as load_agent_settings
from acting_api.analysis_worker import (
    AnalysisWorker,
    AnalysisWorkerPool,
    SummaryAnalyzer,
)
from acting_api.auth.dependencies import (
    build_consent_gate_dependency,
    build_current_user_dependency,
    build_optional_user_dependency,
    build_rate_limited_user_dependency,
)
from acting_api.auth.apple import AppleProviderVerifier
from acting_api.auth.development import DevelopmentProviderVerifier
from acting_api.auth.google import GoogleProviderVerifier
from acting_api.auth.jwt import JwtService
from acting_api.auth.providers import ProviderRegistry
from acting_api.admin import build_router as build_admin_router
from acting_api.admissions import build_router as build_admissions_router
from acting_api.auth.router import build_router as build_auth_router
from acting_api.coaching import build_router as build_coaching_router
from acting_api.community import build_router as build_community_router
from acting_api.config import load_gateway_settings
from acting_api.consents import (
    build_router as build_consents_router,
    seed_consent_documents,
)
from acting_api.db.community_store import CommunityStore
from acting_api.db.store import PostgresStore
from acting_api.keepalive import keep_alive_loop
from acting_api.practice_sessions import build_router as build_practice_router
from acting_api.profile import build_router as build_profile_router
from acting_api.ratelimit import RateLimiter
from acting_api.reports import build_router as build_reports_router
from acting_api.storage import S3Storage
from acting_api.uploads import build_router as build_uploads_router
from acting_report.config import load_settings as load_report_settings
from acting_summary.config import load_settings as load_summary_settings

logger = logging.getLogger(__name__)


def _ensure_app_logging() -> None:
    """앱 로그가 journald까지 닿게 한다.

    uvicorn은 자기 로거에만 핸들러를 붙이므로, 설정이 없으면 앱 로거의 INFO는
    조용히 버려진다. 기동 시 남기는 S3 자격증명 method가 role 전환이 실제로
    일어났는지 확인하는 유일한 증거라 반드시 보여야 한다.

    root 레벨은 건드리지 않는다 — WARNING으로 두어야 서드파티 라이브러리의
    INFO 로그가 쏟아지지 않는다.
    """
    if not logging.getLogger().handlers:
        logging.basicConfig()
    logging.getLogger("acting_api").setLevel(logging.INFO)


class HealthResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["ok"]
    services: list[str]
    model: str
    keep_alive: bool
    commit: str


def create_app(
    *,
    client=None,
    gateway_settings=None,
    summary_settings=None,
    agent_settings=None,
    report_settings=None,
    store=None,
    community_store=None,
    clock=time.monotonic,
    keep_alive_client=None,
    jwt_service=None,
    provider_registry=None,
    s3_client=None,
    s3_storage=None,
    analysis_worker=None,
    analyzer=None,
) -> FastAPI:
    _ensure_app_logging()
    gateway_settings = gateway_settings or load_gateway_settings()
    summary_settings = summary_settings or load_summary_settings()
    agent_settings = agent_settings or load_agent_settings()
    report_settings = report_settings or load_report_settings()
    client = client or genai.Client(api_key=summary_settings.api_key)
    owns_store = store is None
    if store is None:
        store = PostgresStore.from_url(gateway_settings.database_url)
    # 게시판은 기존 도메인과 공유하는 상태가 없어 같은 엔진만 나눠 쓴다. 가짜 store 를
    # 넣는 테스트에서는 엔진이 없으므로 community_store 를 직접 주입한다.
    if community_store is None and isinstance(store, PostgresStore):
        community_store = CommunityStore.from_store(store)
    limiter = RateLimiter(clock=clock)
    jwt_service = jwt_service or JwtService(gateway_settings.jwt_secret)
    if provider_registry is None:
        provider_verifiers = [
            GoogleProviderVerifier(gateway_settings.google_oauth_client_id),
            AppleProviderVerifier(gateway_settings.apple_oauth_client_id),
        ]
        if gateway_settings.development_auth_provider:
            provider_verifiers.append(DevelopmentProviderVerifier())
        provider_registry = ProviderRegistry(provider_verifiers)
    current_user = build_current_user_dependency(store, jwt_service)
    # 커뮤니티 읽기 전용. 토큰이 없으면 익명으로 통과한다.
    optional_user = build_optional_user_dependency(store, jwt_service)
    rate_limited_user = build_rate_limited_user_dependency(current_user, limiter)
    consented_user = build_consent_gate_dependency(rate_limited_user, store)
    if s3_storage is None and gateway_settings.s3_configured:
        if s3_client is not None:
            s3_storage = S3Storage(bucket=gateway_settings.s3_bucket, client=s3_client)
        else:
            session = boto3.Session()
            credentials = session.get_credentials()
            if credentials is None:
                raise RuntimeError("S3 credentials could not be resolved")
            logger.info("S3 credential method=%s", credentials.method)
            s3_storage = S3Storage.from_session(
                bucket=gateway_settings.s3_bucket,
                region=gateway_settings.aws_region,
                session=session,
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
        try:
            published = await run_in_threadpool(
                seed_consent_documents,
                store,
                gateway_settings.consent_docs_dir,
            )
            logger.info("Published %d consent documents during startup", published)
        except Exception:
            logger.exception("Consent document startup seed failed")
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

    async def storage_credentials_error_handler(_request, _exc):
        return JSONResponse(
            status_code=503,
            content={"detail": "storage_not_configured"},
        )

    for exception_type in (
        NoCredentialsError,
        CredentialRetrievalError,
        MetadataRetrievalError,
    ):
        app.add_exception_handler(
            exception_type,
            storage_credentials_error_handler,
        )

    @app.get(
        "/health",
        responses={200: {"model": HealthResponse}},
    )
    def health():
        return {
            "status": "ok",
            "services": ["summary", "coach", "report"],
            "model": summary_settings.model,
            "keep_alive": bool(gateway_settings.keep_alive_url),
            # 이전 배포 환경 변수가 있으면 진단 메타데이터로 계속 노출한다.
            "commit": os.environ.get("RENDER_GIT_COMMIT", "unknown")[:7],
        }

    # 운영 대시보드 조회. ADMIN_OPS_TOKEN 이 없으면 build_router 가 None 을 주고
    # 라우터 자체가 붙지 않는다 — 기본값이 '열림'이 되지 않게 한 것이다.
    admin_router = build_admin_router(
        store=store,
        storage=s3_storage,
        admin_token=os.environ.get("ADMIN_OPS_TOKEN"),
        # 팀이 테스트로 만든 세션을 빼는 목록. 쉼표로 구분한다.
        exclude_emails=tuple(
            e.strip()
            for e in os.environ.get("ADMIN_OPS_EXCLUDE_EMAILS", "").split(",")
            if e.strip()
        ),
    )
    if admin_router is not None:
        app.include_router(admin_router)

    # 입시 공고 조회. 인증이 필요 없다 — 공개 정보이고 가입 전에도 보여야 한다.
    # 데이터 파일이 없으면 라우터를 붙이지 않는다(배포에서 빠져도 기동은 되게).
    admissions_router = build_admissions_router(
        admissions_file=gateway_settings.admissions_file,
    )
    if admissions_router is not None:
        app.include_router(admissions_router)

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
    # 프로필(닉네임)은 동의 게이트를 걸지 않는다 — 동의 화면에서 이름을 함께 받는다.
    app.include_router(
        build_profile_router(
            store=store,
            rate_limited_user=rate_limited_user,
        )
    )
    if community_store is not None:
        app.include_router(
            build_community_router(
                community_store=community_store,
                # 읽기는 가입 전에도 열어 둔다. 쓰기는 동의까지 마친 계정만.
                viewer=optional_user,
                author=consented_user,
            )
        )
    app.include_router(
        build_uploads_router(
            store=store,
            storage=s3_storage,
            rate_limited_user=consented_user,
        )
    )
    app.include_router(
        build_practice_router(
            store=store,
            storage=s3_storage,
            rate_limited_user=consented_user,
            ungated_user=rate_limited_user,
        )
    )
    app.include_router(
        build_coaching_router(
            client=client,
            settings=agent_settings,
            store=store,
            rate_limited_user=consented_user,
        )
    )
    app.include_router(
        build_reports_router(
            client=client,
            settings=report_settings,
            store=store,
            storage=s3_storage,
            rate_limited_user=consented_user,
        )
    )

    if gateway_settings.static_dir is not None:
        _mount_static_frontend(app, gateway_settings.static_dir)

    return app


_PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def _extensionless_media_type(path) -> str | None:
    """Next metadata 라우트 산출물(out/opengraph-image 등)은 확장자가 없어
    파일명 기반 MIME 추측이 불가능하므로 매직 바이트로 판별한다.
    None을 반환하면 FileResponse 기본 동작을 따른다."""
    if path.suffix:
        return None
    try:
        with path.open("rb") as file:
            head = file.read(len(_PNG_SIGNATURE))
    except OSError:
        return None
    if head.startswith(_PNG_SIGNATURE):
        return "image/png"
    return None


def _mount_static_frontend(app: FastAPI, static_root) -> None:
    """Next.js `output: 'export'` 결과물(out/)을 같은 origin에서 서빙한다.

    API 라우트(/v2/*, /health)가 먼저 등록되어 있어 catch-all보다 우선한다.
    Next export는 trailingSlash 기본값에서 /home -> home.html 형태로 파일을
    만들기 때문에 경로에 .html을 붙여 매핑한다.
    """
    static_root = static_root.resolve()
    next_assets = static_root / "_next"
    if next_assets.is_dir():
        app.mount("/_next", StaticFiles(directory=next_assets), name="next-assets")

    index_html = static_root / "index.html"
    not_found_html = static_root / "404.html"

    @app.get("/{full_path:path}", include_in_schema=False)
    def serve_frontend(full_path: str):
        if full_path.startswith("v2/") or full_path == "health":
            raise HTTPException(status_code=404)
        candidate = (static_root / full_path).resolve() if full_path else index_html
        if not str(candidate).startswith(str(static_root)):
            raise HTTPException(status_code=404)
        if candidate.is_file():
            return FileResponse(candidate, media_type=_extensionless_media_type(candidate))
        html_candidate = static_root / f"{full_path}.html"
        if html_candidate.is_file():
            return FileResponse(html_candidate)
        if not_found_html.is_file():
            return FileResponse(not_found_html, status_code=404)
        if index_html.is_file():
            return FileResponse(index_html)
        raise HTTPException(status_code=404)
