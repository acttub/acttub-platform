import json

from acting_agent.schema import CoachSession, CoachTurn
from acting_agent.transcript import export_transcript, save_transcript
from agent_test_support import SESSION_ID, SUMMARY, SUMMARY_ID


def _closed_session():
    return CoachSession(
        session_id=SESSION_ID,
        summary_id=SUMMARY_ID,
        summary=SUMMARY,
        turns=[
            CoachTurn(role="ai", text="첫 질문"),
            CoachTurn(role="actor", text="긴장했어요"),
            CoachTurn(role="ai", text="마무리"),
        ],
        question_count=1,
        status="closed",
        close_reason="gap_stated",
    )


def test_export_transcript_contains_session_and_turns():
    t = export_transcript(_closed_session())
    assert t["session_id"] == SESSION_ID
    assert t["status"] == "closed" and t["close_reason"] == "gap_stated"
    assert t["question_count"] == 1
    assert t["turns"] == [
        {"role": "ai", "text": "첫 질문"},
        {"role": "actor", "text": "긴장했어요"},
        {"role": "ai", "text": "마무리"},
    ]


def test_save_transcript_writes_readable_json(tmp_path):
    path = save_transcript(_closed_session(), tmp_path)
    assert path == tmp_path / f"{SESSION_ID}.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    assert data["turns"][1]["text"] == "긴장했어요"  # ensure_ascii=False 확인 겸


def test_save_transcript_creates_directory(tmp_path):
    target = tmp_path / "nested" / "transcripts"
    path = save_transcript(_closed_session(), target)
    assert path.exists()
