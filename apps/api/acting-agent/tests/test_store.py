from acting_agent.schema import CoachSession, CoachTurn
from acting_agent.store import InMemorySessionStore
from agent_test_support import SUMMARY, SUMMARY_ID, SUBTEXT


def test_summary_roundtrip_uses_deep_copies():
    store = InMemorySessionStore()
    store.add_summary(SUMMARY_ID, SUMMARY, SUBTEXT)

    loaded = store.get_summary(SUMMARY_ID)
    assert loaded is not None
    summary, subtext = loaded
    summary.anomalies.clear()
    subtext.subtext = "변경"

    reloaded = store.get_summary(SUMMARY_ID)
    assert reloaded is not None
    assert len(reloaded[0].anomalies) == len(SUMMARY.anomalies)
    assert reloaded[1].subtext == SUBTEXT.subtext


def test_create_get_save_roundtrip():
    store = InMemorySessionStore()
    s = CoachSession(
        session_id="x",
        summary_id=SUMMARY_ID,
        summary=SUMMARY,
        turns=[
            CoachTurn(
                role="ai",
                text="질문",
                action="probe_intent",
                focus_timestamp="00:12",
            )
        ],
    )
    store.create(s)
    assert store.get("x") is not s
    s.question_count = 3
    assert store.get("x").question_count == 0
    store.save(s)
    loaded = store.get("x")
    assert loaded.question_count == 3
    assert loaded.turns[0].action == "probe_intent"
    assert loaded.turns[0].focus_timestamp == "00:12"
    loaded.question_count = 5
    assert store.get("x").question_count == 3


def test_get_missing_returns_none():
    store = InMemorySessionStore()
    assert store.get("nope") is None
    assert store.get_summary(SUMMARY_ID) is None
