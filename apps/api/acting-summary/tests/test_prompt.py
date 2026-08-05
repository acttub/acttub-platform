import hashlib

import pytest

from acting_summary.prompt import (
    OBSERVATION_SYSTEM_PROMPT,
    WITH_VIDEO,
    buildObservationPrompt,
)
from acting_summary.schema import ActorMaterial


ACTOR = ActorMaterial(
    situation="면접장",
    character="긴장한 지원자",
    goal="면접관이 다시 보게 만든다",
    blockage_kind="표현",
    blockage_detail="슬픈 척하는 것 같다",
    duration_ms=12_000,
)


def test_observation_system_prompt_matches_so_canonical_text_character_for_character():
    assert hashlib.sha256(OBSERVATION_SYSTEM_PROMPT.encode()).hexdigest() == (
        "b73330b8c3d7e3f37e1786d893837771e84de9b1adf54558bd18dd1d25ac2c95"
    )


def test_with_video_hallucination_guard_is_present_in_full():
    assert WITH_VIDEO in OBSERVATION_SYSTEM_PROMPT
    assert "사람이 안 보이면 안 보인다고" in WITH_VIDEO
    assert "얼굴이 안 잡히면 표정 이야기를 하지 않는다" in WITH_VIDEO
    assert "소리가 없으면 말·호흡 이야기를 하지 않는다" in WITH_VIDEO
    assert "확실하지 않으면 쓰지 않는다" in WITH_VIDEO


def test_build_observation_prompt_includes_goal_and_actor_material():
    prompt = buildObservationPrompt(ACTOR)

    assert "- 상황: 면접장" in prompt
    assert "- 캐릭터: 긴장한 지원자" in prompt
    assert "- 이번 테이크의 목적: 면접관이 다시 보게 만든다" in prompt
    assert "- 배우가 고른 막히는 지점: 표현" in prompt
    assert "- 배우가 쓴 상세: 슬픈 척하는 것 같다" in prompt
    assert "서브텍스트" not in prompt


@pytest.mark.parametrize(
    "required_text",
    [
        "0개도 정상이다",
        "3개를 넘기지 않는다",
        "사람이 안 보이면 안 보인다고",
        "얼굴이 안 잡히면 표정 이야기를 하지 않는다",
        "소리가 없으면 말·호흡 이야기를 하지 않는다",
        "어두우면 어두워서 안 보인다고 쓴다",
        "확실하지 않으면 쓰지 않는다",
        "빈칸을 채우려고 그럴듯한 몸짓·시선·표정을 만들어내지 않는다",
        "해석하지 않고 평가하지 않는다",
        "단정할 수 없으면 그 항목을 적지 않고 uncertainties 로 옮긴다",
    ],
)
def test_canonical_observation_prompt_keeps_each_hallucination_guard(required_text):
    assert required_text in OBSERVATION_SYSTEM_PROMPT
