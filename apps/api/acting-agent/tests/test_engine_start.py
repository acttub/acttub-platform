from acting_agent import engine
from agent_test_support import SUBTEXT, SUMMARY, SUMMARY_ID, FakeClient, _Resp


def _out(question, analysis="내부 분석"):
    return _Resp(parsed=engine.AgentOut(analysis=analysis, question=question))


def test_start_creates_session_and_first_probe():
    client = FakeClient([_out("그 말이 잠깐 멎은 것처럼 들렸는데, 인물은 뭘 기다리고 있었을까요?")])
    session, out = engine.start(
        "sid", SUMMARY, SUBTEXT, summary_id=SUMMARY_ID, client=client, model="m"
    )
    assert out.action == "probe_intent"
    assert session.summary_id == SUMMARY_ID
    assert session.question_count == 1
    assert session.turns[-1].role == "ai" and session.turns[-1].text == out.utterance
    # severity high anomaly가 타깃이 되고 그 시각이 focus 로 나간다
    assert out.focus_timestamp == "00:12"

    system, user_msg = client.models.calls[0][2].system_instruction, client.models.calls[0][1][0]
    # 규칙은 system_instruction 으로, 장면·관찰은 사용자 메시지로 갈린다
    assert "[금지 문형 — 하나라도 쓰면 실패]" in system
    assert "[금지 문형 — 하나라도 쓰면 실패]" not in user_msg
    assert "1.2초 멈춤" in user_msg


def test_low_severity_anomaly_is_not_used_as_target():
    # 신뢰도 게이트 — low 관찰은 질문 타깃으로 승격되지 않는다
    client = FakeClient([_out("이 장면에서 인물이 원하는 게 뭐예요?")])
    _, out = engine.start(
        "sid-low", SUMMARY, SUBTEXT, summary_id=SUMMARY_ID, client=client, model="m"
    )
    assert "시선 이탈" not in client.models.calls[0][1][0]
    assert out.utterance != ""


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
    _, out = engine.start(
        "sid2",
        empty,
        SUBTEXT,
        summary_id=SUMMARY_ID,
        client=FakeClient([_out("원하는 걸 이루지 못하면 인물에게 무슨 일이 벌어질까요?")]),
        model="m",
    )
    assert out.utterance != "" and out.focus_timestamp == ""


def test_missing_input_asks_for_the_scene_first():
    # 장면을 모르면 관찰을 해석할 수 없다 — 입력 결손이 관찰보다 앞선다
    client = FakeClient([_out("이 장면은 무슨 상황이에요?")])
    engine.start("sid-noinput", SUMMARY, None, summary_id=SUMMARY_ID, client=client, model="m")
    user_msg = client.models.calls[0][1][0]
    assert "입력 결손(상황)" in user_msg
    assert "아직 관찰은 인용하지 않는다" in user_msg


def test_generate_retries_on_banned_shape():
    bad = _out("이거 의도하신 거예요, 아니면 그냥 그렇게 나온 거예요?")
    good = _out("그 말이 멎은 것처럼 들렸는데, 인물은 뭘 기다리고 있었을까요?")
    client = FakeClient([bad, good])
    _, out = engine.start(
        "sid3", SUMMARY, SUBTEXT, summary_id=SUMMARY_ID, client=client, model="m"
    )
    assert out.utterance == "그 말이 멎은 것처럼 들렸는데, 인물은 뭘 기다리고 있었을까요?"
    assert len(client.models.calls) == 2
    assert "[재생성]" in client.models.calls[1][1][0]


def test_falls_back_when_retry_also_violates():
    # 가드가 경고에 그치면 금지 문형이 배우에게 그대로 나간다 → 폴백으로 바꾼다
    bad = _out("이거 의도하신 거예요, 아니면 그냥 그렇게 나온 거예요?")
    client = FakeClient([bad, bad])
    _, out = engine.start(
        "sid4", SUMMARY, SUBTEXT, summary_id=SUMMARY_ID, client=client, model="m"
    )
    assert out.utterance == "이 장면에서 인물이 원하는 게 뭐예요?"
