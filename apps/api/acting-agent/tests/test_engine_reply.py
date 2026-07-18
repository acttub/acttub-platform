from acting_agent import engine
from acting_agent.schema import CoachReply, CoachSession, CoachTurn
from agent_test_support import SUMMARY, SUMMARY_ID, FakeClient, RaisingClient, _Resp


def _open_session():
    return CoachSession(
        session_id="x",
        summary_id=SUMMARY_ID,
        summary=SUMMARY,
        question_count=1,
        turns=[CoachTurn(role="ai", text="첫 질문")],
    )


def test_reply_digs_cause():
    reply = CoachReply(
        action="dig_cause",
        utterance="그럼 그 직전엔 무슨 생각이었어?",
        focus_timestamp="00:12",
    )
    session = _open_session()
    out = engine.reply(
        session,
        "긴장했어요",
        client=FakeClient([_Resp(parsed=reply)]),
        model="m",
    )
    assert out.action == "dig_cause" and out.done is False
    assert session.turns[-2].role == "actor" and session.turns[-2].action is None
    assert session.turns[-1].action == "dig_cause"
    assert session.turns[-1].focus_timestamp == "00:12"


def test_reply_gap_stated_closes():
    reply = CoachReply(
        action="close", utterance="차이를 잘 짚었어.", done=True, reason="gap_stated"
    )
    s = _open_session()
    out = engine.reply(
        s,
        "긴장이 목소리를 작게 만든 것 같아요",
        client=FakeClient([_Resp(parsed=reply)]),
        model="m",
    )
    assert out.reason == "gap_stated" and s.status == "closed"
    assert s.turns[-1].action == "close"


def test_reply_exhausted_closes():
    reply = CoachReply(
        action="close",
        utterance="더 물을 게 없네. 오늘 짚은 걸 기억해.",
        done=True,
        reason="exhausted",
    )
    s = _open_session()
    out = engine.reply(
        s, "모르겠어요", client=FakeClient([_Resp(parsed=reply)]), model="m"
    )
    assert out.reason == "exhausted" and s.status == "closed"


def test_reply_limit_guard_no_llm_call():
    s = _open_session()
    s.question_count = engine.MAX_QUESTIONS
    out = engine.reply(s, "음...", client=RaisingClient(), model="m")
    assert out.action == "close" and out.reason == "limit" and s.status == "closed"


def test_reply_custom_max_questions_honored():
    s = _open_session()
    s.question_count = 3
    out = engine.reply(s, "음...", client=RaisingClient(), model="m", max_questions=3)
    assert out.action == "close" and out.reason == "limit" and s.status == "closed"


def test_reply_user_ended_guard_no_llm_call():
    out = engine.reply(_open_session(), "그만할래", client=RaisingClient(), model="m")
    assert out.action == "close" and out.reason == "user_ended"


def test_reply_on_closed_session_returns_closed():
    s = _open_session()
    s.status = "closed"
    s.close_reason = "gap_stated"
    out = engine.reply(s, "더 얘기", client=RaisingClient(), model="m")
    assert out.done is True and out.reason == "gap_stated"


def test_reply_deflect_passthrough():
    reply = CoachReply(action="deflect", utterance="그건 화면에 어떻게 보이길 원했어?")
    out = engine.reply(
        _open_session(),
        "제 감정 진짜 같았어요?",
        client=FakeClient([_Resp(parsed=reply)]),
        model="m",
    )
    assert out.action == "deflect" and out.done is False
