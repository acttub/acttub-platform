from acting_agent.summary_schema import (
    Anomaly,
    Observation,
    SceneSummary,
    SegmentCheck,
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
    segment_scan=[SegmentCheck(start="00:00", end="00:05", note="이상 없음")],
    anomalies=[
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
    ],
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


class RaisingClient:
    class _M:
        def generate_content(self, *a, **k):
            raise AssertionError("LLM은 호출되면 안 됨")

    def __init__(self):
        self.models = self._M()
