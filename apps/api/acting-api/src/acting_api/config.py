import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

DEFAULT_RATE_LIMIT_PER_MIN = 10
DEFAULT_KEEP_ALIVE_INTERVAL_SEC = 600


@dataclass
class GatewaySettings:
    api_keys: tuple[str, ...]
    rate_limit_per_min: int = DEFAULT_RATE_LIMIT_PER_MIN
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
    raw = os.environ.get("API_KEYS", "")
    keys = tuple(k.strip() for k in raw.split(",") if k.strip())
    limit = int(os.environ.get("RATE_LIMIT_PER_MIN", DEFAULT_RATE_LIMIT_PER_MIN))
    keep_alive_url = os.environ.get("KEEP_ALIVE_URL") or None
    keep_alive_interval = int(
        os.environ.get("KEEP_ALIVE_INTERVAL_SEC", DEFAULT_KEEP_ALIVE_INTERVAL_SEC)
    )
    return GatewaySettings(
        api_keys=keys,
        rate_limit_per_min=limit,
        keep_alive_url=keep_alive_url,
        keep_alive_interval_sec=keep_alive_interval,
    )
