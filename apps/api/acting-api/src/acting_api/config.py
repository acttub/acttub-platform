import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

from acting_api.db.engine import normalize_database_url

DEFAULT_KEEP_ALIVE_INTERVAL_SEC = 600


@dataclass
class GatewaySettings:
    database_url: str
    keep_alive_url: str | None = None
    keep_alive_interval_sec: int = DEFAULT_KEEP_ALIVE_INTERVAL_SEC


def _default_env_path() -> Path:
    # src/acting_api/config.py -> parents[2] == 프로젝트 루트(acting-api)
    return Path(__file__).resolve().parents[2] / ".env"


def load_gateway_settings(env_path: Path | None = None) -> GatewaySettings:
    if env_path is None:
        env_path = _default_env_path()
    if env_path.exists():
        load_dotenv(env_path)
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL not configured")
    keep_alive_url = os.environ.get("KEEP_ALIVE_URL") or None
    keep_alive_interval = int(
        os.environ.get("KEEP_ALIVE_INTERVAL_SEC", DEFAULT_KEEP_ALIVE_INTERVAL_SEC)
    )
    return GatewaySettings(
        database_url=normalize_database_url(database_url),
        keep_alive_url=keep_alive_url,
        keep_alive_interval_sec=keep_alive_interval,
    )
