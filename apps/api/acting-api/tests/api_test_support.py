import json

from acting_agent.summary_schema import ObservationPack as AgentObservationPack
from acting_llm.openai_client import TokenUsage
from acting_report.schema import AnalysisNextTake, AnalysisReport
from acting_summary.schema import ActorMaterial, ObservationPack

SUMMARY_ID = "11111111-1111-4111-8111-111111111111"

SUBTEXT = ActorMaterial(
    situation="상황",
    character="인물",
    goal="상대가 멈추게 한다",
    blockage_kind="분석",
    blockage_detail="왜 지금 말하는지 모르겠다",
    duration_ms=1000,
)
SUMMARY = ObservationPack(
    observations=[
        {
            "start_ms": 120,
            "end_ms": 130,
            "label": "대사 직전에 숨을 들이쉰다",
            "confidence": 0.9,
        }
    ],
    uncertainties=["얼굴은 화면 밖이라 확인되지 않음"],
)
AGENT_SUMMARY = AgentObservationPack.model_validate(SUMMARY.model_dump(mode="json"))

ANALYSIS_HANDOFF = {
    "handoff_type": "analysis",
    "blocked_point": "왜 이 말을 지금 하는지",
    "line_meaning": "상대가 떠나기 전에 붙잡으려는 말",
    "timing_reason": "상대가 돌아서려는 순간이라서",
    "target_effect": "상대가 발걸음을 멈추게 한다",
    "scene_evidence": ["상대가 돌아선다"],
    "actor_words": ["지금 놓치면 끝이야"],
    "coach_summary": "떠나려는 상대를 지금 붙잡는다",
    "uncertainties": [],
}
COACH_QUESTION = {
    "message": "그 말을 지금 꺼내서 상대가 어떻게 되길 바라는 거야?",
    "status": "continue",
    "handoff": None,
}
COACH_FOLLOWUP = {
    "message": "지금 놓치면 끝이라는 말에서 출발하면, 상대에게 무엇을 이해시키려는 거야?",
    "status": "continue",
    "handoff": None,
}
COACH_COMPLETE = {
    "message": "지금 놓치면 끝이라서, 돌아서는 상대의 발걸음을 멈추게 하려는 말이야.",
    "status": "complete",
    "handoff": ANALYSIS_HANDOFF,
}

REPORT = AnalysisReport(
    report_type="analysis",
    title="돌아서기 전에 붙잡는 말",
    actor_discovery="지금 놓치면 끝이라는 걸 발견했다.",
    line_meaning="상대가 떠나기 전에 붙잡으려는 말이다.",
    timing_reason="상대가 돌아서려는 순간이라 지금 말한다.",
    target_effect="상대가 발걸음을 멈추게 한다.",
    next_take=AnalysisNextTake(
        direction="상대의 발걸음을 멈추게 하는 일을 시험한다.", tested=False
    ),
    acting_caution="정보만 전하지 않고 상대에게 하려는 일을 놓치지 않는다.",
    evidence=["상대가 돌아선다."],
    uncertainties=[],
    source_handoff_id="00000000-0000-4000-8000-000000000001",
)


class FakeTextGenerator:
    def __init__(self, responses=()):
        self.responses = [
            json.dumps(item, ensure_ascii=False) if isinstance(item, dict) else item
            for item in responses
        ]
        self.calls = []

    def __call__(self, system_instruction, prompt):
        self.calls.append((system_instruction, prompt))
        return self.responses.pop(0), TokenUsage(0, 0, 0)

    def queue_response(self, response):
        self.responses.append(
            json.dumps(response, ensure_ascii=False)
            if isinstance(response, dict)
            else response
        )


class FakeModelResponse:
    def __init__(self, parsed=None, text=None):
        self.parsed, self.text = parsed, text


class _Models:
    def __init__(self, responses):
        self._responses, self.calls = list(responses), []

    def generate_content(self, model, contents, config):
        self.calls.append((model, contents, config))
        return self._responses.pop(0)


class FakeClient:
    def __init__(self, responses=()):
        self.models = _Models(responses)

    def queue_response(self, response) -> None:
        self.models._responses.append(response)
