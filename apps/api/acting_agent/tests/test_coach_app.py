from fastapi.testclient import TestClient

from acting_agent.app import create_app
from acting_agent.config import Settings
from acting_agent.schema import CoachReply
from support import SUMMARY, FakeClient, _Resp


def _client(replies):
    responses = [_Resp(parsed=r) for r in replies]
    app = create_app(
        client=FakeClient(responses), settings=Settings(api_key="k", model="m")
    )
    return TestClient(app)


def test_start_then_reply_flow():
    c = _client(
        [
            CoachReply(
                action="probe_intent",
                utterance="그 대사 뒤에 사이가 길게 비었더라 — 의도한 거야?",
                focus_timestamp="00:12",
            ),
            CoachReply(action="dig_cause", utterance="왜 그랬어?"),
        ]
    )
    r1 = c.post("/coach/start", json={"summary": SUMMARY.model_dump()})
    assert r1.status_code == 200
    sid = r1.json()["session_id"]
    assert r1.json()["action"] == "probe_intent"
    r2 = c.post("/coach/reply", json={"session_id": sid, "text": "긴장했어요"})
    assert r2.status_code == 200 and r2.json()["action"] == "dig_cause"


def test_reply_unknown_session_404():
    c = _client([])
    r = c.post("/coach/reply", json={"session_id": "nope", "text": "hi"})
    assert r.status_code == 404


def test_start_parse_failure_returns_502():
    app = create_app(
        client=FakeClient([_Resp(text="nope"), _Resp(text="still nope")]),
        settings=Settings(api_key="k", model="m"),
    )
    tc = TestClient(app)
    r = tc.post("/coach/start", json={"summary": SUMMARY.model_dump()})
    assert r.status_code == 502
