import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

DEFAULT_MODEL = "gemini-2.5-flash"
# 10턴은 배우가 지친다는 실사용 피드백이 있어 8로 줄였다. 대화는 대개 상한에서
# 끊기지 배우가 스스로 정리해서 닫히지 않는다 — 상한이 곧 체감 길이다.
DEFAULT_MAX_QUESTIONS = 8


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
