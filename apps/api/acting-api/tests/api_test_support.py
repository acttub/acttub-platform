from acting_agent.engine import AgentOut, AgentOutWithClose
from acting_agent.summary_schema import SceneSummary as AgentSceneSummary
from acting_report.schema import ActingReport, BiggestProblem
from acting_summary.schema import Anomaly, Observation, SceneSummary, SubText

SUMMARY_ID = "11111111-1111-4111-8111-111111111111"

SUBTEXT = SubText(situation="상황", character="인물", subtext="서브")
SUMMARY = SceneSummary(
    observation=Observation(
        timeline="t",
        dialogue="d",
        tempo="te",
        pitch="p",
        movement="m",
        expression="e",
        emotion="em",
    ),
    summary="s",
    intent_alignment="i",
    key_moment="00:10-00:15 절정 구간",
    key_dimension="템포",
    anomalies=[
        Anomaly(
            start="00:12",
            end="00:13",
            dimension="템포",
            what="1.2초 멈춤",
            why_odd="o",
            likely_cause="c",
            impact_on_intent="ii",
            overlaps_key_moment=True,
            on_key_dimension=True,
            intent_impact="반전",
            severity="high",
            severity_reason="key_moment 구간",
        )
    ],
)
AGENT_SUMMARY = AgentSceneSummary.model_validate(SUMMARY.model_dump(mode="json"))

# 코치 에이전트는 {analysis, question, close} 로 답하고, action·done 은 코드가 정한다.
COACH_QUESTION = AgentOut(
    analysis="내부 분석",
    question="그 말이 멎은 것처럼 들렸는데, 인물은 뭘 기다리고 있었을까요?",
)
COACH_FOLLOWUP = AgentOutWithClose(
    analysis="내부 분석",
    question="그럼 그 자리에서 인물이 지키려던 건 뭐였을까요?",
)

REPORT = ActingReport(
    headline="오늘은 멈춤의 이유를 스스로 찾아냈어",
    biggest_problem=BiggestProblem(
        start="00:12",
        end="00:13",
        dimension="템포",
        description="가장 중요한 순간에 말이 1.2초 멈추면서 흐름이 끊겼어",
    ),
    evidence="00:12에 1.2초 멈춤",
    self_discovery="대사 암기가 불안하면 감정이 끊긴다는 걸 찾아냈어",
    encouragement="원인을 바로 짚어낸 게 좋았어",
    next_step="대사만 소리 내서 세 번 통으로 말해보기",
    comparison="",
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
