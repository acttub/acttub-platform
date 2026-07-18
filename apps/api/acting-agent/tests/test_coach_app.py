from uuid import UUID

from fastapi.testclient import TestClient

from acting_agent.app import create_app
from acting_agent.config import Settings
from acting_agent.schema import CoachReply
from acting_agent.store import (
    InMemorySessionStore,
    SessionWriteConflict,
)
from agent_test_support import SUMMARY, SUMMARY_ID, SUBTEXT, FakeClient, _Resp


def _client(replies, store=None):
    responses = [_Resp(parsed=r) for r in replies]
    if store is None:
        store = InMemorySessionStore()
    store.add_summary(SUMMARY_ID, SUMMARY, SUBTEXT)
    app = create_app(
        client=FakeClient(responses),
        settings=Settings(api_key="k", model="m"),
        store=store,
    )
    return TestClient(app)


def test_start_then_reply_flow():
    store = InMemorySessionStore()
    c = _client(
        [
            CoachReply(
                action="probe_intent",
                utterance="그 대사 뒤에 사이가 길게 비었더라 — 의도한 거야?",
                focus_timestamp="00:12",
            ),
            CoachReply(action="dig_cause", utterance="왜 그랬어?"),
        ],
        store=store,
    )
    r1 = c.post("/coach/start", json={"summary_id": SUMMARY_ID})
    assert r1.status_code == 200
    sid = r1.json()["session_id"]
    assert str(UUID(sid)) == sid
    assert r1.json()["action"] == "probe_intent"
    r2 = c.post("/coach/reply", json={"session_id": sid, "text": "긴장했어요"})
    assert r2.status_code == 200 and r2.json()["action"] == "dig_cause"
    session = store.get(sid)
    assert session is not None
    assert session.summary_id == SUMMARY_ID
    assert session.subtext == SUBTEXT
    assert [turn.action for turn in session.turns] == [
        "probe_intent",
        None,
        "dig_cause",
    ]


def test_reply_unknown_session_404():
    c = _client([])
    r = c.post(
        "/coach/reply",
        json={"session_id": "00000000-0000-4000-8000-000000000099", "text": "hi"},
    )
    assert r.status_code == 404


def test_start_parse_failure_returns_502():
    store = InMemorySessionStore()
    store.add_summary(SUMMARY_ID, SUMMARY, SUBTEXT)
    app = create_app(
        client=FakeClient([_Resp(text="nope"), _Resp(text="still nope")]),
        settings=Settings(api_key="k", model="m"),
        store=store,
    )
    tc = TestClient(app)
    r = tc.post("/coach/start", json={"summary_id": SUMMARY_ID})
    assert r.status_code == 502


def test_reply_parse_failure_does_not_persist_actor_turn():
    store = InMemorySessionStore()
    question = CoachReply(action="probe_intent", utterance="의도하신 거예요?")
    responses = [
        _Resp(parsed=question),
        _Resp(text="nope"),
        _Resp(text="still nope"),
    ]
    app = create_app(
        client=FakeClient(responses),
        settings=Settings(api_key="k", model="m"),
        store=store,
    )
    store.add_summary(SUMMARY_ID, SUMMARY, SUBTEXT)
    tc = TestClient(app)
    sid = tc.post("/coach/start", json={"summary_id": SUMMARY_ID}).json()["session_id"]

    r = tc.post("/coach/reply", json={"session_id": sid, "text": "긴장했어요"})

    assert r.status_code == 502
    session = store.get(sid)
    assert session is not None
    assert len(session.turns) == 1


def test_reply_write_conflict_returns_409_without_overwriting_session():
    class ConflictStore(InMemorySessionStore):
        def save(self, session):
            raise SessionWriteConflict("stale session")

    store = ConflictStore()
    c = _client(
        [
            CoachReply(action="probe_intent", utterance="의도하신 거예요?"),
            CoachReply(action="dig_cause", utterance="왜 그랬어?"),
        ],
        store=store,
    )
    sid = c.post("/coach/start", json={"summary_id": SUMMARY_ID}).json()["session_id"]

    response = c.post("/coach/reply", json={"session_id": sid, "text": "긴장했어요"})

    assert response.status_code == 409
    assert response.json() == {"detail": "session changed concurrently"}
    assert len(store.get(sid).turns) == 1


def test_start_unknown_summary_404():
    c = _client([])
    r = c.post(
        "/coach/start", json={"summary_id": "00000000-0000-4000-8000-000000000000"}
    )
    assert r.status_code == 404


def test_start_rejects_invalid_summary_id():
    c = _client([])
    r = c.post("/coach/start", json={"summary_id": "not-a-uuid"})
    assert r.status_code == 422


def test_start_rejects_legacy_summary_payload():
    c = _client([])
    r = c.post("/coach/start", json={"summary": SUMMARY.model_dump()})
    assert r.status_code == 422


def test_start_rejects_legacy_fields_even_with_summary_id():
    c = _client([])
    r = c.post(
        "/coach/start",
        json={"summary_id": SUMMARY_ID, "summary": SUMMARY.model_dump()},
    )
    assert r.status_code == 422
