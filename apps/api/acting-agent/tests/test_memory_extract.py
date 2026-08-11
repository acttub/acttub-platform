"""연습 하나에서 배우 기억 4칸을 뽑아내는 부분.

이 기억은 다음 연습의 **입력**이 된다. 그래서 여기가 뚫리면 코치 대화에 걸어둔
검사가 통째로 우회된다 -- 뽑아낸 값도 대화와 같은 검사를 통과해야 하고,
통과 못 한 칸은 조용히 버려야지 이전 값을 밀어내면 안 된다.
"""

from __future__ import annotations

import json

from acting_agent.memory_extract import (
    AGENT_WRITABLE_FIELDS,
    MemoryMaterial,
    extract_memory_updates,
)


def _material(**overrides) -> MemoryMaterial:
    base = dict(
        goal="합격하고 싶다",
        blockage_kind="분석",
        sub_branch="대사 분석",
        blockage_detail=None,
        transcripts=("나는 괜찮아. 정말이야.",),
        actor_messages=("차분하게 말하려고 했어요.",),
        existing={},
    )
    base.update(overrides)
    return MemoryMaterial(**base)


def _fixed(payload) -> object:
    def generate(_system: str, _user: str):
        text = payload if isinstance(payload, str) else json.dumps(payload)
        return text, None

    return generate


def test_only_the_fields_the_model_returned_come_back():
    """바뀐 칸만 갱신한다 -- 안 돌려준 칸은 근거가 없다는 뜻이다."""
    result = extract_memory_updates(
        _material(),
        generate=_fixed({"goal": "입시 합격"}),
    )

    assert result.updates == {"goal": "입시 합격"}


def test_gender_and_age_are_refused_even_if_the_model_returns_them():
    """성별·나이는 배우가 직접 넣는 칸이다. 영상이나 말투에서 추론하지 않는다."""
    result = extract_memory_updates(
        _material(),
        generate=_fixed({"gender": "여성", "age": "20대", "goal": "입시 합격"}),
    )

    assert result.updates == {"goal": "입시 합격"}
    assert "gender" in result.rejected
    assert "age" in result.rejected


def test_a_field_that_fails_the_language_check_is_dropped_not_written():
    """금지 표현이 섞이면 그 칸만 버린다. 나머지 칸까지 날리지 않는다."""
    result = extract_memory_updates(
        _material(),
        generate=_fixed(
            {
                "blockage": "배우의 약점은 발성이다",
                "goal": "입시 합격",
            }
        ),
    )

    assert "blockage" not in result.updates
    assert result.updates == {"goal": "입시 합격"}
    assert "blockage" in result.rejected


def test_the_goal_field_may_carry_the_actors_own_word_for_the_outcome():
    """우리 배우 대부분의 목표가 '합격' 이다. 여기서 막으면 목표 칸이 죽는다."""
    result = extract_memory_updates(
        _material(),
        generate=_fixed({"goal": "올해 입시 합격"}),
    )

    assert result.updates == {"goal": "올해 입시 합격"}


def test_the_outcome_word_is_still_blocked_in_the_other_fields():
    """예외는 목표 칸에서만이다. 다른 칸에 오면 코치의 판정으로 읽힌다."""
    result = extract_memory_updates(
        _material(),
        generate=_fixed({"speech_actual": "합격할 만한 발성이다"}),
    )

    assert result.updates == {}
    assert "speech_actual" in result.rejected


def test_the_goal_field_still_blocks_judgement_words():
    """면제는 결과 어휘 하나뿐이다. 평가 어휘는 목표 칸에서도 막는다."""
    result = extract_memory_updates(
        _material(),
        generate=_fixed({"goal": "약점을 고쳐서 합격하기"}),
    )

    assert result.updates == {}
    assert "goal" in result.rejected


def test_unchanged_values_are_not_rewritten():
    """같은 값을 다시 쓰면 근거와 시각만 흔들린다. 달라진 것만 남긴다."""
    result = extract_memory_updates(
        _material(existing={"goal": "입시 합격"}),
        generate=_fixed({"goal": "입시 합격", "speech_self": "차분하게"}),
    )

    assert result.updates == {"speech_self": "차분하게"}


def test_blank_and_oversized_values_are_dropped():
    """빈 칸은 지우는 것과 다르고, 너무 긴 값은 다음 연습 프롬프트를 먹는다."""
    result = extract_memory_updates(
        _material(),
        generate=_fixed({"goal": "   ", "blockage": "가" * 5000}),
    )

    assert result.updates == {}
    assert set(result.rejected) == {"goal", "blockage"}


def test_unparseable_output_yields_no_update_instead_of_raising():
    """모델이 형식을 어겨도 연습 자체는 정상으로 끝나야 한다."""
    result = extract_memory_updates(_material(), generate=_fixed("죄송합니다"))

    assert result.updates == {}


def test_unknown_field_names_are_ignored():
    result = extract_memory_updates(
        _material(),
        generate=_fixed({"favourite_colour": "파랑", "goal": "입시 합격"}),
    )

    assert result.updates == {"goal": "입시 합격"}


def test_agent_writes_four_fields_only():
    assert AGENT_WRITABLE_FIELDS == (
        "goal",
        "blockage",
        "speech_self",
        "speech_actual",
    )


def test_the_prompt_carries_the_material_the_model_needs():
    """받아쓴 대사와 배우가 한 말이 안 들어가면 뽑아낼 근거가 없다."""
    seen: dict[str, str] = {}

    def generate(system: str, user: str):
        seen["system"] = system
        seen["user"] = user
        return json.dumps({}), None

    extract_memory_updates(
        _material(existing={"goal": "예전 목표"}),
        generate=generate,
    )

    assert "나는 괜찮아. 정말이야." in seen["user"]
    assert "차분하게 말하려고 했어요." in seen["user"]
    assert "예전 목표" in seen["user"]
    assert "대사 분석" in seen["user"]
