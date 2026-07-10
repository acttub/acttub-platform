import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

DEFAULT_RATE_LIMIT_PER_MIN = 10


@dataclass
class GatewaySettings:
    api_keys: tuple[str, ...]
    rate_limit_per_min: int = DEFAULT_RATE_LIMIT_PER_MIN


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
    return GatewaySettings(api_keys=keys, rate_limit_per_min=limit)
