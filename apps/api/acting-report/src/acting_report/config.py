import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

DEFAULT_MODEL = "gemini-2.5-flash"


def _project_root() -> Path:
    # src/acting_report/config.py -> parents[2] == 프로젝트 루트(acting-report)
    return Path(__file__).resolve().parents[2]


def _default_store_path() -> Path:
    return _project_root() / "data" / "reports.json"


@dataclass
class Settings:
    api_key: str
    model: str
    store_path: Path = field(default_factory=_default_store_path)


def _default_env_path() -> Path:
    return _project_root().parent / "video-feedback" / ".env"


def load_settings(env_path: Path | None = None) -> Settings:
    if env_path is None:
        env_path = _default_env_path()
    if env_path.exists():
        load_dotenv(env_path)
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError(
            "GEMINI_API_KEY not found. Set it in ../video-feedback/.env or the environment."
        )
    model = os.environ.get("GEMINI_MODEL", DEFAULT_MODEL)
    store_path = Path(os.environ.get("REPORT_STORE_PATH", _default_store_path()))
    return Settings(api_key=api_key, model=model, store_path=store_path)
