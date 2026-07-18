import json
from pathlib import Path

from acting_agent.schema import CoachSession


def export_transcript(session: CoachSession) -> dict:
    return {
        "session_id": session.session_id,
        "status": session.status,
        "close_reason": session.close_reason,
        "question_count": session.question_count,
        "turns": [{"role": t.role, "text": t.text} for t in session.turns],
    }


def save_transcript(session: CoachSession, directory: Path) -> Path:
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{session.session_id}.json"
    path.write_text(
        json.dumps(export_transcript(session), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return path
