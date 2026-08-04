from acting_agent import engine
from acting_agent.schema import CoachSession, CoachTurn
from acting_agent.summary_schema import SubText
from agent_test_support import (
    SUBTEXT,
    SUMMARY,
    SUMMARY_ID,
    FakeClient,
    RaisingClient,
    _Resp,
)


def _out(question, close=False, analysis="내부 분석"):
    return _Resp(
        parsed=engine.AgentOutWithClose(analysis=analysis, question=question, close=close)
    )


def _open_session(**overrides):
    base = dict(
        session_id="x",
        summary_id=SUMMARY_ID,
        summary=SUMMARY,
        subtext=SUBTEXT,
        question_count=1,
        turns=[CoachTurn(role="ai", text="첫 질문")],
    )
    base.update(overrides)
    return CoachSession(**base)


def test_reply_digs_from_the_last_answer():
    session = _open_session()
    out = engine.reply(
        session,
        "붙잡고 싶었어요",
        client=FakeClient([_out("그 말을 하고 나서 인물은 무엇을 기다렸을까요?")]),
        model="m",
    )
    assert out.action == "dig_cause" and out.done is False
    assert session.turns[-2].role == "actor" and session.turns[-2].action is None
    assert session.turns[-1].action == "dig_cause"


def test_reply_closes_when_model_says_close():
    s = _open_session()
    out = engine.reply(
        s,
        "붙잡고 싶었는데 화면에선 놓아준 것처럼 보였네요",
        client=FakeClient([_out("스스로 짚으신 그 문장이 오늘의 답이에요.", close=True)]),
        model="m",
    )
    assert out.done is True and out.reason == "gap_stated" and s.status == "closed"
    assert s.turns[-1].action == "close"


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


def test_denied_observation_is_dropped_from_later_prompts():
    # 배우가 부정한 관찰은 다시 꺼내지 않는다. 상태는 턴에서 되살리므로 DB 왕복에도 살아남는다.
    s = _open_session(
        turns=[CoachTurn(role="ai", text="첫 질문", focus_timestamp="00:12")]
    )
    client = FakeClient([_out("그럼 그 자리에서 인물이 지키려던 건 뭐였을까요?")])
    engine.reply(s, "안 멈췄는데요", client=client, model="m")
    assert "1.2초 멈춤" not in client.models.calls[0][1][0]


def test_used_observation_is_not_offered_twice():
    # 부정하지 않아도 이미 쓴 관찰은 다음 후보에서 빠진다 — 세션이 다음 관찰로 넘어간다
    s = _open_session(
        turns=[CoachTurn(role="ai", text="첫 질문", focus_timestamp="00:12")]
    )
    client = FakeClient([_out("그 자리에서 인물이 지키려던 건 뭐였을까요?")])
    engine.reply(s, "붙잡고 싶었어요", client=client, model="m")
    assert "1.2초 멈춤" not in client.models.calls[0][1][0]


def test_followup_prompt_carries_a_bank_archetype():
    # 꼬리 질문도 원형을 코드가 정한다 — 관찰만 넘기면 은행이 있으나 마나가 된다
    s = _open_session()
    client = FakeClient([_out("그 자리에서 인물이 지키려던 건 뭐였을까요?")])
    engine.reply(s, "붙잡고 싶었어요", client=client, model="m")
    user_msg = client.models.calls[0][1][0]
    assert "은행 원형(" in user_msg


def test_close_turn_is_linted_too():
    # 종료 문구에도 판정이 섞이면 안 된다 — 걸리면 정해둔 마무리 문장으로 바꾼다
    s = _open_session()
    bad = _out("연기가 아주 좋았어요. 오늘 여기까지 할게요.", close=True)
    out = engine.reply(
        s, "제가 놓친 걸 알겠어요", client=FakeClient([bad, bad]), model="m"
    )
    assert out.done is True
    assert out.utterance == engine.SAFE_CLOSING


def test_echo_retry_failure_keeps_first_answer():
    # 되읽기 재시도가 깨져도 멀쩡한 첫 응답을 버리지 않는다 (502가 나던 자리)
    situation = "이별을 통보받은 직후 카페에서"
    s = _open_session(subtext=SubText(situation=situation, character="여성", subtext="붙잡고 싶다"))
    echoed = _out("이별을 통보받은 직후 카페에서 붙잡고 싶으셨던 건 무엇이었을까요?")
    out = engine.reply(
        s,
        "그랬어요",
        client=FakeClient([echoed, _Resp(text="not-json"), _Resp(text="still bad")]),
        model="m",
    )
    assert out.utterance == echoed.parsed.question


def test_converging_instruction_appears_near_the_limit():
    s = _open_session(question_count=engine.MAX_QUESTIONS - engine.CONVERGE_MARGIN)
    client = FakeClient([_out("오늘 짚으신 걸 한 문장으로 하면 뭐가 될까요?")])
    engine.reply(s, "잘 모르겠어요", client=client, model="m")
    user_msg = client.models.calls[0][1][0]
    assert "수렴 구간이다" in user_msg
    # 배우가 스스로 막혔다고 말했을 때만 scaffold 지시가 붙는다
    assert "scaffold" in user_msg


# 실제 대화 8건에서 코치가 이미 던진 질문을 그대로 다시 던졌다. 원인은 폴백 문장이
# 1번 질문(Q_PURPOSE)과 글자 그대로 같은데, 이미 무엇을 물었는지 모르고 넣어서다.
# 8/3 se8tify 는 20턴을 채운 최우수 사용자였고 14번째 턴에서 1번 질문을 다시 받았다.
def test_fallback_never_repeats_a_question_already_asked():
    session = _open_session(
        turns=[
            CoachTurn(role="ai", text="이 장면에서 인물이 원하는 게 뭐예요?"),
            CoachTurn(role="actor", text="형에게 인정받고 싶어요"),
        ],
    )
    # 두 번 다 금지 문형에 걸려 폴백으로 떨어지는 상황.
    banned = "지금 연기에 점수를 준다면 몇 점일까요?"
    out = engine.reply(
        session,
        "네",
        client=FakeClient([_out(banned), _out(banned)]),
        model="m",
    )
    asked = [t.text for t in session.turns if t.role == "ai"]
    assert out.utterance not in asked[:-1], f"이미 물어본 질문을 또 냈다: {out.utterance}"
    assert out.utterance.strip(), "폴백이 비어 있으면 안 된다"


def test_fallback_still_works_when_nothing_asked_yet():
    session = _open_session(turns=[])
    banned = "지금 연기에 점수를 준다면 몇 점일까요?"
    out = engine.reply(
        session,
        "모르겠어요",
        client=FakeClient([_out(banned), _out(banned)]),
        model="m",
    )
    assert out.utterance.strip()


# 폴백을 다 써도 같은 질문을 또 내느니 끝낸다. 대화를 원점으로 돌리는 것이
# 배우에게 가장 큰 이탈 신호였다 — "또 물어보시는 건가요?"(8/3).
def test_closes_instead_of_repeating_when_fallbacks_run_out():
    from acting_agent.guard import FALLBACK_QUESTIONS

    session = _open_session(
        turns=[CoachTurn(role="ai", text=q) for q in FALLBACK_QUESTIONS],
    )
    banned = "지금 연기에 점수를 준다면 몇 점일까요?"
    out = engine.reply(
        session,
        "네",
        client=FakeClient([_out(banned), _out(banned)]),
        model="m",
    )
    assert out.done is True
    assert out.action == "close"
    assert out.reason == "exhausted"
    assert session.status == "closed"


# 폴백이 아니라 모델이 정상 생성한 질문이어도, 이미 물어본 것과 같으면 끝낸다.
def test_closes_when_the_model_repeats_an_earlier_question():
    asked = "그 순간 인물은 무엇을 기다렸을까요?"
    session = _open_session(turns=[CoachTurn(role="ai", text=asked)])
    out = engine.reply(
        session,
        "모르겠어요",
        client=FakeClient([_out(asked)]),
        model="m",
    )
    assert out.done is True
    assert out.reason == "exhausted"


# 새 질문이면 당연히 계속 간다 — 종료 가드가 과하게 걸리면 대화가 다 끊긴다.
def test_a_new_question_still_continues():
    session = _open_session(turns=[CoachTurn(role="ai", text="첫 질문")])
    out = engine.reply(
        session,
        "붙잡고 싶었어요",
        client=FakeClient([_out("그 말을 하고 나서 인물은 무엇을 기다렸을까요?")]),
        model="m",
    )
    assert out.done is False
    assert out.action == "dig_cause"
