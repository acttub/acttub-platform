import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

DEFAULT_MODEL = "gemini-2.5-flash"
DEFAULT_MAX_QUESTIONS = 10


@dataclass
class Settings:
    api_key: str
    model: str
    max_questions: int = DEFAULT_MAX_QUESTIONS


def _default_env_path() -> Path:
    # src/acting_agent/config.py -> parents[2] == 프로젝트 루트(acting_agent)
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
    max_questions = int(os.environ.get("COACH_MAX_QUESTIONS", DEFAULT_MAX_QUESTIONS))
    return Settings(api_key=api_key, model=model, max_questions=max_questions)
