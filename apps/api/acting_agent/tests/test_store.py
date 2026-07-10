from acting_agent.store import InMemorySessionStore
from acting_agent.schema import CoachSession
from support import SUMMARY


def test_create_get_save_roundtrip():
    store = InMemorySessionStore()
    s = CoachSession(session_id="x", summary=SUMMARY)
    store.create(s)
    assert store.get("x") is s
    s.question_count = 3
    store.save(s)
    assert store.get("x").question_count == 3


def test_get_missing_returns_none():
    assert InMemorySessionStore().get("nope") is None
