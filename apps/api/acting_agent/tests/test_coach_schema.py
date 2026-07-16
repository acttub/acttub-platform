from acting_agent.schema import CoachTurn, CoachReply, CoachSession
from agent_test_support import SESSION_ID, SUMMARY, SUMMARY_ID


def test_coach_reply_defaults():
    r = CoachReply(action="probe_intent", utterance="q")
    assert r.done is False and r.reason is None and r.focus_timestamp == ""


def test_coach_reply_reason_enum_has_no_empty_value():
    # Gemini response_schema는 enum에 빈 문자열을 허용하지 않는다 (400 INVALID_ARGUMENT)
    schema = CoachReply.model_json_schema()
    enum_values = [
        v
        for sub in schema["properties"]["reason"].get("anyOf", [])
        for v in sub.get("enum", [])
    ]
    assert enum_values and "" not in enum_values


def test_coach_session_defaults_and_roundtrip():
    s = CoachSession(session_id=SESSION_ID, summary_id=SUMMARY_ID, summary=SUMMARY)
    assert s.turns == [] and s.question_count == 0 and s.status == "open"
    s.turns.append(
        CoachTurn(role="ai", text="hi", action="probe_intent", focus_timestamp="00:12")
    )
    loaded = CoachSession.model_validate(s.model_dump())
    assert loaded.summary_id == SUMMARY_ID
    assert loaded.turns[0].action == "probe_intent"
    assert loaded.turns[0].focus_timestamp == "00:12"
