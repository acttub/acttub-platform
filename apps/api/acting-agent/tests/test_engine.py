import json

from acting_agent.engine import parse_coaching_response, reply, start
from acting_agent.prompt import safe_template
from acting_agent.schema import CoachSession, CoachTurn
from acting_llm.openai_client import TokenUsage
from agent_test_support import (
    ACTOR,
    PRACTICE_SESSION_ID,
    SESSION_ID,
    SUMMARY,
    SUMMARY_ID,
)


class FakeGenerate:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def __call__(self, system, prompt):
        self.calls.append((system, prompt))
        return self.responses.pop(0), TokenUsage(0, 0, 0)


OPENING = json.dumps(
    {"message": "그 말을 지금 꺼내는 이유부터 볼게.", "status": "continue", "handoff": None},
    ensure_ascii=False,
)


def _start(*, actor=ACTOR, observation_pack=SUMMARY):
    session, _ = start(
        SESSION_ID,
        observation_pack,
        actor,
        practice_session_id=PRACTICE_SESSION_ID,
        summary_id=SUMMARY_ID if observation_pack is not None else None,
        sub_branch="대사 분석",
        generate=FakeGenerate([OPENING]),
    )
    return session


def test_complete_with_null_handoff_is_downgraded_to_continue():
    parsed = parse_coaching_response(
        '```json\n{"message":"조금 더 볼게.","status":"complete","handoff":null}\n```'
    )
    assert parsed.status == "continue"
    assert parsed.handoff is None


def test_parse_failure_falls_back_to_raw_text_message():
    parsed = parse_coaching_response("방금 말한 지점에서 하나만 더 볼게.")
    assert parsed.message == "방금 말한 지점에서 하나만 더 볼게."
    assert parsed.status == "continue"


def test_start_generates_first_coach_turn_from_actor_blockage_detail():
    response = json.dumps(
        {"message": "그 말에서 가장 막히는 대목은 어디야?", "status": "continue", "handoff": None},
        ensure_ascii=False,
    )
    generate = FakeGenerate([response])

    session, result = start(
        SESSION_ID,
        SUMMARY,
        ACTOR,
        practice_session_id=PRACTICE_SESSION_ID,
        summary_id=SUMMARY_ID,
        sub_branch="대사 분석",
        generate=generate,
    )

    assert result.message == "그 말에서 가장 막히는 대목은 어디야?"
    assert session.blockage_detail == ACTOR.blockage_detail
    assert [(turn.role, turn.text) for turn in session.turns] == [
        ("actor", ACTOR.blockage_detail),
        ("ai", result.message),
    ]
    assert f"## 배우의 최신 말\n{ACTOR.blockage_detail}" in generate.calls[0][1]


def test_start_uses_goal_when_blockage_detail_is_empty():
    actor = ACTOR.model_copy(update={"blockage_detail": ""})
    generate = FakeGenerate([OPENING])

    session, _ = start(
        SESSION_ID,
        None,
        actor,
        practice_session_id=PRACTICE_SESSION_ID,
        summary_id=None,
        sub_branch="대사 분석",
        generate=generate,
    )

    assert session.turns[0] == CoachTurn(role="actor", text=actor.goal)
    assert f"## 배우의 최신 말\n{actor.goal}" in generate.calls[0][1]


def test_forbidden_hit_regenerates_once_then_uses_safe_template():
    forbidden = json.dumps(
        {"message": "점수로 정리할게.", "status": "continue", "handoff": None},
        ensure_ascii=False,
    )
    generate = FakeGenerate([forbidden, forbidden])

    result = reply(_start(), "왜 지금 말하는지 모르겠어.", generate=generate)

    assert len(generate.calls) == 2
    assert "금지어가 노출됐습니다: 점수" in generate.calls[1][1]
    assert result.message == safe_template()


def test_expression_blockage_selects_expression_prompt():
    response = json.dumps(
        {"message": "무엇이 어색한지 하나만 말해줘.", "status": "continue", "handoff": None},
        ensure_ascii=False,
    )
    actor = ACTOR.model_copy(
        update={"blockage_kind": "표현", "blockage_detail": "표정이 어색해."}
    )
    generate = FakeGenerate([response])

    reply(_start(actor=actor), "표정이 어색해.", generate=generate)

    assert "실제 연기로 옮기도록 돕는" in generate.calls[0][0]


def test_start_without_observation_pack_uses_actor_words_only():
    response = json.dumps(
        {"message": "왜 지금 말하는지부터 볼게.", "status": "continue", "handoff": None},
        ensure_ascii=False,
    )
    generate = FakeGenerate([response])

    session, _ = start(
        SESSION_ID,
        None,
        ACTOR,
        practice_session_id=PRACTICE_SESSION_ID,
        summary_id=None,
        sub_branch="대사 분석",
        generate=generate,
    )

    assert session.observation_pack is None
    assert "아직 영상에서 확인된 것이 없다" in generate.calls[0][1]
    assert f"## 배우의 최신 말\n{ACTOR.blockage_detail}" in generate.calls[0][1]


def test_actor_reply_follows_generated_opening_turn():
    response = json.dumps(
        {"message": "그 말에서 가장 막히는 대목은 어디야?", "status": "continue", "handoff": None},
        ensure_ascii=False,
    )
    generate = FakeGenerate([response])
    session = _start()

    result = reply(session, "왜 지금 이 말을 하는지 모르겠어.", generate=generate)

    assert result.message == "그 말에서 가장 막히는 대목은 어디야?"
    assert [(turn.role, turn.text) for turn in session.turns] == [
        ("actor", ACTOR.blockage_detail),
        ("ai", "그 말을 지금 꺼내는 이유부터 볼게."),
        ("actor", "왜 지금 이 말을 하는지 모르겠어."),
        ("ai", "그 말에서 가장 막히는 대목은 어디야?"),
    ]
    assert "## 배우의 최신 말\n왜 지금 이 말을 하는지 모르겠어." in generate.calls[0][1]


def test_closing_word_appends_completion_instruction_but_stores_actor_words_only():
    response = json.dumps(
        {
            "message": "지금까지 찾은 말로 마무리할게.",
            "status": "complete",
            "handoff": {
                "handoff_type": "analysis",
                "blocked_point": "왜 지금 말하는지",
                "line_meaning": "상대를 붙잡는 말",
                "timing_reason": "상대가 돌아서는 순간",
                "target_effect": "상대가 멈추게 한다",
                "scene_evidence": [],
                "actor_words": ["여기서 그만할게"],
                "coach_summary": "상대를 붙잡으려는 말이다",
                "uncertainties": ["장면에서 다시 확인하지 못함"],
            },
        },
        ensure_ascii=False,
    )
    generate = FakeGenerate([response])
    session = _start()

    result = reply(session, "여기서 그만할게", generate=generate)

    assert result.status == "complete"
    assert "## 배우의 마무리 요청" in generate.calls[0][1]
    assert "더 질문하지 말고 지금까지 모인 내용만으로" in generate.calls[0][1]
    assert session.turns[-2] == CoachTurn(role="actor", text="여기서 그만할게")
    # 종료어는 배우가 남긴 말이 아니므로 handoff 에 남기지 않는다
    assert result.handoff["actor_words"] == []


def test_handoff_keeps_real_words_and_drops_non_strings():
    response = json.dumps(
        {
            "message": "여기까지 정리할게.",
            "status": "complete",
            "handoff": {
                "line_meaning": "붙잡으려는 말",
                "timing_reason": "떠나려 해서",
                "target_effect": "멈추게 하기",
                "scene_evidence": [],
                # 모델이 리스트 안에 문자열이 아닌 값을 섞어 보내도 터지지 않아야 한다
                "actor_words": ["그만", "상대를 붙잡고 싶었어요", 3, None],
                "coach_summary": "상대를 붙잡으려는 말이다",
                "uncertainties": [],
            },
        },
        ensure_ascii=False,
    )
    session = _start()

    result = reply(session, "상대를 붙잡고 싶었어요", generate=FakeGenerate([response]))

    assert result.handoff["actor_words"] == ["상대를 붙잡고 싶었어요"]


def test_reply_keeps_latest_actor_message_out_of_recent_turns():
    session = CoachSession(
        session_id=SESSION_ID,
        practice_session_id=PRACTICE_SESSION_ID,
        summary_id=SUMMARY_ID,
        observation_pack=SUMMARY,
        actor=ACTOR,
        blockage_kind="분석",
        sub_branch="대사 분석",
        turns=[CoachTurn(role="actor", text=f"이전 배우 말 {i}") for i in range(9)],
    )
    response = json.dumps(
        {"message": "그 말의 이유를 하나만 더 볼게.", "status": "continue", "handoff": None},
        ensure_ascii=False,
    )
    generate = FakeGenerate([response])

    reply(session, "이번 최신 말", generate=generate)

    recent = generate.calls[0][1].split("## 최근 대화\n", 1)[1].split(
        "\n\n## 배우의 최신 말", 1
    )[0]
    assert "이전 배우 말 0" not in recent
    assert "이번 최신 말" not in recent
