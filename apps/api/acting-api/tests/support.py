from acting_agent.schema import CoachReply
from acting_agent.summary_schema import (
    Anomaly as AgentAnomaly,
    Observation as AgentObservation,
    SceneSummary as AgentSceneSummary,
)
from acting_report.schema import ActingReport, BiggestProblem
from acting_report.session_schema import CoachSession, CoachTurn
from acting_report.summary_schema import (
    Anomaly as ReportAnomaly,
    Observation as ReportObservation,
    SceneSummary as ReportSceneSummary,
)

AGENT_SUMMARY = AgentSceneSummary(
    observation=AgentObservation(
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
        AgentAnomaly(
            start="00:12",
            end="00:13",
            dimension="템포",
            what="1.2초 멈춤",
            why_odd="o",
            likely_cause="c",
            impact_on_intent="ii",
            severity="high",
            severity_reason="key_moment 구간",
        )
    ],
)

COACH_QUESTION = CoachReply(
    action="probe_intent",
    utterance="그 멈춤, 의도한 거야?",
    focus_timestamp="00:12",
)
COACH_FOLLOWUP = CoachReply(action="dig_cause", utterance="그 순간 무슨 생각 했어?")

REPORT_SESSION = CoachSession(
    session_id="sid1",
    summary=ReportSceneSummary(
        observation=ReportObservation(
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
            ReportAnomaly(
                start="00:12",
                end="00:13",
                dimension="템포",
                what="1.2초 멈춤",
                why_odd="o",
                likely_cause="c",
                impact_on_intent="ii",
                severity="high",
                severity_reason="key_moment 구간",
            )
        ],
    ),
    turns=[
        CoachTurn(role="ai", text="[00:12] 1.2초 멈춤 — 의도한 거야?"),
        CoachTurn(role="actor", text="대사가 기억 안 났어요"),
    ],
    question_count=1,
    status="closed",
    close_reason="gap_stated",
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


class _Resp:
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
