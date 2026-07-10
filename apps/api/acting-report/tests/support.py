from acting_report.schema import ActingReport, BiggestProblem, ReportRecord
from acting_report.session_schema import CoachSession, CoachTurn
from acting_report.summary_schema import (
    Anomaly,
    Observation,
    SceneSummary,
)

OBS = Observation(
    timeline="t",
    dialogue="d",
    tempo="te",
    pitch="p",
    movement="m",
    expression="e",
    emotion="em",
)
SUMMARY = SceneSummary(
    observation=OBS,
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
            severity="high",
            severity_reason="key_moment 구간",
        ),
        Anomaly(
            start="00:20",
            end="00:20",
            dimension="움직임",
            what="시선 이탈",
            why_odd="o2",
            likely_cause="c2",
            impact_on_intent="ii2",
            severity="low",
            severity_reason="주변 구간",
        ),
    ],
)

SESSION = CoachSession(
    session_id="sid1",
    summary=SUMMARY,
    turns=[
        CoachTurn(role="ai", text="[00:12] 1.2초 멈춤 — 의도한 거야?"),
        CoachTurn(role="actor", text="대사가 기억 안 났어요"),
        CoachTurn(role="ai", text="그 순간 무슨 생각 했어?"),
        CoachTurn(role="actor", text="다음 대사 생각하느라 감정이 끊겼어요"),
    ],
    question_count=2,
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
    evidence='00:12에 1.2초 멈춤. 너도 "다음 대사 생각하느라 감정이 끊겼어요"라고 말했지',
    self_discovery="대사 암기가 불안하면 감정이 끊긴다는 걸 스스로 찾아냈어",
    encouragement="멈춤의 원인을 남 탓 없이 바로 짚어낸 게 좋았어",
    next_step="다음 연습 전에 이 장면 대사만 소리 내서 세 번 통으로 말해보기",
    comparison="",
)

PREV_RECORD = ReportRecord(
    created_at="2026-07-01T00:00:00+00:00",
    session_id="sid0",
    report=REPORT.model_copy(
        update={
            "biggest_problem": BiggestProblem(
                start="00:05",
                end="00:06",
                dimension="시선",
                description="상대를 안 보고 바닥을 봤어",
            ),
            "next_step": "상대 눈을 보고 대사하기",
        }
    ),
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
    def __init__(self, responses):
        self.models = _Models(responses)
