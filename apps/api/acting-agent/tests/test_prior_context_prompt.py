"""코치가 지난 연습을 알고 시작하는가.

세 갈래를 프롬프트에 넣는다 -- 배우에 대해 쌓인 기억, 같은 연습의 지난 대화,
지난 연습에서 해보기로 했지만 아직 안 해본 것.

가장 중요한 건 **없을 때 지금과 똑같이 동작하는 것**이다. 첫 연습은 참고할 게
하나도 없는데, 거기서 빈 제목만 늘어놓으면 모델이 없는 내용을 지어낸다.
"""

from __future__ import annotations

from acting_agent.prompt import PRIOR_CONTEXT_MAX_CHARS, build_chat_prompt
from acting_agent.schema import ActorMaterial, CoachSession, PriorContext


def _session(**overrides) -> CoachSession:
    actor = ActorMaterial(
        situation="면접장",
        character="지원자",
        goal="합격",
        blockage_kind="분석",
        blockage_detail="대사가 안 붙어요",
        duration_ms=60000,
    )
    base = dict(
        session_id="s1",
        practice_session_id="p1",
        summary_id=None,
        observation_pack=None,
        actor=actor,
        blockage_kind="분석",
        sub_branch="대사 분석",
        blockage_detail="대사가 안 붙어요",
    )
    base.update(overrides)
    return CoachSession(**base)


def test_a_first_practice_prompt_has_no_prior_section():
    """참고할 게 없으면 칸 자체를 만들지 않는다 -- 빈 제목은 지어내기를 부른다."""
    prompt = build_chat_prompt(_session(), "안녕하세요")

    assert "지난" not in prompt
    assert "배우에 대해" not in prompt


def test_actor_memory_reaches_the_prompt():
    prompt = build_chat_prompt(
        _session(
            prior=PriorContext(
                memory={"goal": "입시 합격", "speech_actual": "말끝을 흐린다"}
            )
        ),
        "안녕하세요",
    )

    assert "입시 합격" in prompt
    assert "말끝을 흐린다" in prompt


def test_the_same_practice_reopened_carries_the_earlier_conversation():
    prompt = build_chat_prompt(
        _session(prior=PriorContext(earlier_conversation="지난번엔 호흡 이야기를 했다")),
        "다시 왔어요",
    )

    assert "지난번엔 호흡 이야기를 했다" in prompt


def test_things_planned_but_not_yet_tried_reach_the_prompt():
    prompt = build_chat_prompt(
        _session(prior=PriorContext(pending_takes=("한 박자 늦게 말해보기",))),
        "안녕하세요",
    )

    assert "한 박자 늦게 말해보기" in prompt


def test_the_prior_section_is_capped_so_it_cannot_eat_the_conversation():
    """지난 것이 길다고 이번 대화를 밀어내면 안 된다."""
    prompt = build_chat_prompt(
        _session(prior=PriorContext(earlier_conversation="가" * 5000)),
        "안녕하세요",
    )

    assert len(prompt) < 5000
    # 이번 대화에 필요한 것은 그대로 남아야 한다.
    assert "안녕하세요" in prompt
    assert "남은 응답" in prompt


def test_prior_context_is_marked_as_background_not_as_video_evidence():
    """지난 기록을 영상 근거로 착각하면 없는 장면을 말하게 된다."""
    prompt = build_chat_prompt(
        _session(prior=PriorContext(memory={"blockage": "호흡이 급해진다"})),
        "안녕하세요",
    )

    section = prompt.split("배우에 대해")[1].split("##")[0]
    assert "영상" in section or "참고" in section


def test_an_empty_prior_context_behaves_like_none():
    assert build_chat_prompt(_session(prior=PriorContext()), "hi") == build_chat_prompt(
        _session(), "hi"
    )


def test_cap_is_a_module_level_constant_so_it_can_be_tuned():
    assert PRIOR_CONTEXT_MAX_CHARS > 0
