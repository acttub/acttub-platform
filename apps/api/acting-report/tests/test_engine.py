import json

import pytest

from acting_llm.openai_client import TokenUsage
from acting_report.engine import generate_report

ANALYSIS_HANDOFF = {
    "handoff_type": "analysis",
    "blocked_point": "왜 지금 말하는지",
    "line_meaning": "상대를 붙잡는 말",
    "timing_reason": "상대가 돌아서려는 순간",
    "target_effect": "상대가 멈추게 한다",
    "scene_evidence": ["상대가 돌아선다"],
    "actor_words": ["놓치면 끝이야"],
    "coach_summary": "돌아서는 상대를 붙잡는다",
    "uncertainties": [],
}
EXPRESSION_HANDOFF = {
    "handoff_type": "expression",
    "blocked_point": "대본을 읽는 느낌",
    "line_meaning": "상대를 붙잡는 말",
    "timing_reason": "상대가 돌아서려는 순간",
    "playable_action": "상대가 멈추게 한다",
    "experiment": {"instruction": "상대가 멈추게 말해본다", "tested": True},
    "observed_change": "혼자 읽는 느낌이 줄었다",
    "next_take": "상대를 멈추게 하는 일만 유지한다",
    "reusable_direction": "상대에게 하는 일을 먼저 정한다",
    "acting_trap": "억양을 먼저 정하지 않는다",
    "actor_training": None,
    "actor_words": ["읽는 느낌"],
    "coach_summary": "상대를 멈추게 하니 읽는 느낌이 줄었다",
    "uncertainties": [],
}
OBSERVATION_PACK = {
    "observations": [
        {
            "start_ms": 120,
            "end_ms": 130,
            "label": "대사가 시작된다",
            "confidence": 0.9,
        }
    ],
    "uncertainties": [],
}


class FakeGenerate:
    def __init__(self, response=""):
        self.response = response
        self.calls = []

    def __call__(self, system, prompt):
        self.calls.append((system, prompt))
        return self.response, TokenUsage(0, 0, 0)


def test_unconfirmed_analysis_is_blocked_without_model_call():
    generate = FakeGenerate()

    report = generate_report(
        report_type="analysis",
        video_summary=OBSERVATION_PACK,
        confirmed_handoff=ANALYSIS_HANDOFF,
        confirmed=False,
        coaching_handoff_id="handoff-id",
        generate=generate,
    )

    assert report.model_dump() == {
        "report_type": "blocked",
        "reason": "confirmed_analysis_handoff_required",
    }
    assert generate.calls == []


@pytest.mark.parametrize(
    ("handoff", "confirmed"),
    [
        (None, True),
        (EXPRESSION_HANDOFF, False),
        ({**EXPRESSION_HANDOFF, "experiment": {"instruction": "시도", "tested": False}}, True),
        ({**EXPRESSION_HANDOFF, "observed_change": ""}, True),
    ],
)
def test_expression_gate_blocks_all_four_conditions_without_model_call(
    handoff, confirmed
):
    generate = FakeGenerate()

    report = generate_report(
        report_type="expression",
        video_summary=OBSERVATION_PACK,
        confirmed_handoff=handoff,
        confirmed=confirmed,
        coaching_handoff_id="expression-id",
        analysis_handoff=ANALYSIS_HANDOFF,
        generate=generate,
    )

    assert report.reason == "confirmed_expression_handoff_required"
    assert generate.calls == []


def test_analysis_report_accepts_fenced_json_and_overrides_source_id():
    response = {
        "report_type": "analysis",
        "title": "붙잡는 말",
        "actor_discovery": "놓치면 끝이라는 걸 발견했다.",
        "line_meaning": "상대를 붙잡는 말이다.",
        "timing_reason": "상대가 돌아서는 순간이다.",
        "target_effect": "상대가 멈추게 한다.",
        "next_take": {"direction": "상대를 멈추게 해본다.", "tested": False},
        "acting_caution": "정보만 전하지 않는다.",
        "evidence": ["상대가 돌아선다."],
        "uncertainties": [],
        "source_handoff_id": "model-made-id",
    }
    generate = FakeGenerate(
        f"```json\n{json.dumps(response, ensure_ascii=False)}\n```"
    )

    report = generate_report(
        report_type="analysis",
        video_summary=OBSERVATION_PACK,
        confirmed_handoff=ANALYSIS_HANDOFF,
        confirmed=True,
        coaching_handoff_id="server-id",
        generate=generate,
    )

    assert report.source_handoff_id == "server-id"
    model_input = json.loads(generate.calls[0][1])
    assert set(model_input) == {
        "video_summary",
        "confirmed_handoff",
        "confirmation",
    }
    assert model_input["video_summary"] == OBSERVATION_PACK


def test_expression_input_includes_analysis_handoff_as_reference():
    response = {
        "report_type": "expression",
        "title": "붙잡는 표현",
        "blocked_point": "대본을 읽는 느낌",
        "expression_core": "상대를 멈추게 한다",
        "line_meaning": "상대를 붙잡는 말",
        "timing_reason": "상대가 돌아서는 순간",
        "playable_action": "상대가 멈추게 한다",
        "effective_experiment": {"instruction": "멈추게 말한다", "tested": True},
        "observed_change": "읽는 느낌이 줄었다",
        "next_take": "멈추게 하는 일만 유지한다",
        "acting_trap": "억양을 먼저 정하지 않는다",
        "actor_training": {
            "title": "상대 멈추기",
            "purpose": "상대에게 하는 일을 붙잡는다",
            "duration_minutes": 5,
            "steps": ["할 일을 정한다", "대사를 말한다", "변화를 확인한다"],
            "focus": "상대에게 하는 일",
            "success_check": "말할 이유가 생긴다",
            "tested": False,
        },
        "evidence": ["읽는 느낌이 줄었다고 말했다"],
        "actor_words": ["읽는 느낌"],
        "uncertainties": [],
        "source_handoff_ids": {"analysis": None, "expression": "fake"},
    }
    generate = FakeGenerate(json.dumps(response, ensure_ascii=False))

    report = generate_report(
        report_type="expression",
        video_summary=OBSERVATION_PACK,
        confirmed_handoff=EXPRESSION_HANDOFF,
        confirmed=True,
        coaching_handoff_id="expression-id",
        analysis_handoff=ANALYSIS_HANDOFF,
        analysis_handoff_id="analysis-id",
        generate=generate,
    )

    model_input = json.loads(generate.calls[0][1])
    assert model_input["analysis_handoff"] == ANALYSIS_HANDOFF
    assert report.source_handoff_ids.model_dump() == {
        "analysis": "analysis-id",
        "expression": "expression-id",
    }
