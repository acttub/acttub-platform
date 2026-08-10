import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

# 운영이 실제로 쓰는 모델과 같은 값이어야 한다. 예전 기본값(gemini-2.5-flash)은
# GEMINI_MODEL 이 빠지거나 오타 났을 때 아무 표시 없이 다른 모델로 분석하게 만들었다.
DEFAULT_MODEL = "gemini-3-flash-preview"


@dataclass
class Settings:
    api_key: str
    model: str


def _default_env_path() -> Path:
    # src/acting_summary/config.py -> parents[2] == 프로젝트 루트(acting-summary)
    project_root = Path(__file__).resolve().parents[2]
    return project_root.parent / "video-feedback" / ".env"


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
    return Settings(api_key=api_key, model=model)
