from acting_agent import engine
from acting_agent.schema import CoachReply
from support import SUMMARY, FakeClient, _Resp


def test_start_creates_session_and_first_probe():
    reply = CoachReply(
        action="probe_intent",
        utterance="그 대사 뒤에 사이가 길게 비었더라 — 의도한 거야?",
        focus_timestamp="00:12",
    )
    client = FakeClient([_Resp(parsed=reply)])
    session, out = engine.start("sid", SUMMARY, client=client, model="m")
    assert out.action == "probe_intent"
    assert session.question_count == 1
    assert session.turns[-1].role == "ai" and session.turns[-1].text == out.utterance
    # 프롬프트에 anomaly material이 실려 나갔는지
    sent_prompt = client.models.calls[0][1][0]
    assert "1.2초 멈춤" in sent_prompt


def test_start_with_empty_anomalies_still_produces_utterance():
    from acting_agent.summary_schema import Observation, SceneSummary

    empty = SceneSummary(
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
        key_moment="00:00 시작",
        key_dimension="감정",
        segment_scan=[],
        anomalies=[],
    )
    reply = CoachReply(
        action="probe_intent", utterance="처음부터 끝까지 톤이 한 색이던데 — 의도한 거야?"
    )
    _, out = engine.start(
        "sid2", empty, client=FakeClient([_Resp(parsed=reply)]), model="m"
    )
    assert out.utterance != ""


def test_generate_retries_on_forbidden_word():
    bad = CoachReply(action="probe_intent", utterance="연기력이 부족해")
    good = CoachReply(
        action="probe_intent", utterance="그 대사 뒤에 사이가 길게 비었던데 — 왜 그랬어?"
    )
    client = FakeClient([_Resp(parsed=bad), _Resp(parsed=good)])
    _, out = engine.start("sid3", SUMMARY, client=client, model="m")
    assert out.utterance == good.utterance
    assert len(client.models.calls) == 2
