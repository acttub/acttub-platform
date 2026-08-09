import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

from acting_api.db.engine import normalize_database_url

DEFAULT_KEEP_ALIVE_INTERVAL_SEC = 600
DEFAULT_ANALYSIS_WORKER_CONCURRENCY = 1
# 놀고 있을 때 다음 분석을 집어 오는 간격. 업로드를 마친 배우의 첫 대기에 그대로
# 붙으므로 2.0에서 0.5로 줄였다(2026-08-09). 조회 한 번이라 DB 부담이 거의 없다.
DEFAULT_ANALYSIS_WORKER_POLL_INTERVAL_SEC = 0.5
DEFAULT_ANALYSIS_LEASE_SEC = 1800
DEFAULT_ANALYSIS_SWEEP_INTERVAL_SEC = 60.0
DEFAULT_CONSENT_DOCS_DIR = Path(__file__).resolve().parents[2] / "consent_docs"
DEFAULT_ADMISSIONS_FILE = (
    Path(__file__).resolve().parents[2] / "admissions" / "notices.json"
)
DEFAULT_GOOGLE_OAUTH_CLIENT_ID = (
    "462651930952-625pcnhrjib79r7990fqsdqhsterdij2."
    "apps.googleusercontent.com"
)
# 네이티브 iOS "Sign in with Apple" identityToken의 aud = 앱 번들 ID.
DEFAULT_APPLE_OAUTH_CLIENT_ID = "com.acttub.app"


@dataclass
class GatewaySettings:
    database_url: str
    jwt_secret: str
    google_oauth_client_id: str | None = DEFAULT_GOOGLE_OAUTH_CLIENT_ID
    apple_oauth_client_id: str | None = DEFAULT_APPLE_OAUTH_CLIENT_ID
    development_auth_provider: bool = False
    keep_alive_url: str | None = None
    keep_alive_interval_sec: int = DEFAULT_KEEP_ALIVE_INTERVAL_SEC
    s3_bucket: str | None = None
    # 자격증명은 boto3 기본 체인이 환경변수에서 직접 읽는다. 이 두 필드는 클라이언트
    # 생성에 쓰이지 않지만, 반쪽 설정을 걸러내고 "키를 줘도 코드가 넘기지 않는다"를
    # 테스트로 붙잡아 두기 위해 남긴다. 지우면 그 회귀 방어가 함께 사라진다.
    aws_access_key_id: str | None = None
    aws_secret_access_key: str | None = None
    aws_region: str | None = None
    analysis_worker_concurrency: int = DEFAULT_ANALYSIS_WORKER_CONCURRENCY
    analysis_worker_poll_interval_sec: float = (
        DEFAULT_ANALYSIS_WORKER_POLL_INTERVAL_SEC
    )
    analysis_lease_sec: int = DEFAULT_ANALYSIS_LEASE_SEC
    analysis_sweep_interval_sec: float = DEFAULT_ANALYSIS_SWEEP_INTERVAL_SEC
    static_dir: Path | None = None
    consent_docs_dir: Path | None = DEFAULT_CONSENT_DOCS_DIR
    admissions_file: Path | None = DEFAULT_ADMISSIONS_FILE

    @property
    def s3_configured(self) -> bool:
        return bool(self.s3_bucket and self.aws_region)


def _default_env_path() -> Path:
    # src/acting_api/config.py -> parents[2] == 프로젝트 루트(acting-api)
    return Path(__file__).resolve().parents[2] / ".env"


def _load_environment(env_path: Path | None) -> None:
    if env_path is None:
        env_path = _default_env_path()
    if env_path.exists():
        load_dotenv(env_path)


def load_database_url(env_path: Path | None = None) -> str:
    _load_environment(env_path)
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL not configured")
    return normalize_database_url(database_url)


def load_gateway_settings(env_path: Path | None = None) -> GatewaySettings:
    database_url = load_database_url(env_path)
    jwt_secret = os.environ.get("JWT_SECRET")
    if not jwt_secret:
        raise RuntimeError("JWT_SECRET not configured")
    keep_alive_url = os.environ.get("KEEP_ALIVE_URL") or None
    keep_alive_interval = int(
        os.environ.get("KEEP_ALIVE_INTERVAL_SEC", DEFAULT_KEEP_ALIVE_INTERVAL_SEC)
    )
    s3_values = {
        "s3_bucket": os.environ.get("S3_BUCKET") or None,
        "aws_access_key_id": os.environ.get("AWS_ACCESS_KEY_ID") or None,
        "aws_secret_access_key": os.environ.get("AWS_SECRET_ACCESS_KEY") or None,
        "aws_region": os.environ.get("AWS_REGION") or None,
    }
    if bool(s3_values["s3_bucket"]) != bool(s3_values["aws_region"]):
        raise RuntimeError(
            "S3_BUCKET and AWS_REGION must be configured together"
        )
    if bool(s3_values["aws_access_key_id"]) != bool(
        s3_values["aws_secret_access_key"]
    ):
        raise RuntimeError(
            "AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY must be configured together"
        )
    worker_concurrency = int(
        os.environ.get(
            "ANALYSIS_WORKER_CONCURRENCY", DEFAULT_ANALYSIS_WORKER_CONCURRENCY
        )
    )
    worker_poll_interval = float(
        os.environ.get(
            "ANALYSIS_WORKER_POLL_INTERVAL_SEC",
            DEFAULT_ANALYSIS_WORKER_POLL_INTERVAL_SEC,
        )
    )
    analysis_lease_sec = int(
        os.environ.get("ANALYSIS_LEASE_SEC", DEFAULT_ANALYSIS_LEASE_SEC)
    )
    sweep_interval = float(
        os.environ.get(
            "ANALYSIS_SWEEP_INTERVAL_SEC", DEFAULT_ANALYSIS_SWEEP_INTERVAL_SEC
        )
    )
    if min(
        worker_concurrency,
        worker_poll_interval,
        analysis_lease_sec,
        sweep_interval,
    ) <= 0:
        raise RuntimeError("analysis worker settings must be positive")
    static_dir_value = os.environ.get("STATIC_DIR") or None
    static_dir = None
    if static_dir_value:
        static_dir = Path(static_dir_value).resolve()
        if not static_dir.is_dir():
            raise RuntimeError(f"STATIC_DIR is not a directory: {static_dir}")
    consent_docs_dir_value = os.environ.get("CONSENT_DOCS_DIR") or None
    consent_docs_dir = (
        Path(consent_docs_dir_value).resolve()
        if consent_docs_dir_value
        else DEFAULT_CONSENT_DOCS_DIR
    )
    return GatewaySettings(
        database_url=database_url,
        jwt_secret=jwt_secret,
        # override 시 웹 번들의 GOOGLE_CLIENT_ID(apps/web/src/lib/config/env.ts)와
        # 반드시 같은 값이어야 한다 — 다르면 audience 불일치로 모든 구글 로그인이 401.
        google_oauth_client_id=(
            os.environ.get("GOOGLE_OAUTH_CLIENT_ID", "").strip()
            or DEFAULT_GOOGLE_OAUTH_CLIENT_ID
        ),
        # 네이티브 앱 번들 ID가 곧 aud. 콤마 구분으로 복수 audience 지정 가능.
        apple_oauth_client_id=(
            os.environ.get("APPLE_OAUTH_CLIENT_ID", "").strip()
            or DEFAULT_APPLE_OAUTH_CLIENT_ID
        ),
        development_auth_provider=(
            os.environ.get("DEVELOPMENT_AUTH_PROVIDER", "").strip().lower()
            in {"1", "true"}
        ),
        keep_alive_url=keep_alive_url,
        keep_alive_interval_sec=keep_alive_interval,
        **s3_values,
        analysis_worker_concurrency=worker_concurrency,
        analysis_worker_poll_interval_sec=worker_poll_interval,
        analysis_lease_sec=analysis_lease_sec,
        analysis_sweep_interval_sec=sweep_interval,
        static_dir=static_dir,
        consent_docs_dir=consent_docs_dir,
    )
