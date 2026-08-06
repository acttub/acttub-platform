from acting_agent.schema import CoachSession, CoachTurn
from acting_agent.store import InMemorySessionStore
from agent_test_support import (
    ACTOR,
    PRACTICE_SESSION_ID,
    SESSION_ID,
    SUMMARY,
    SUMMARY_ID,
)


def test_session_store_roundtrip_has_observation_pack_and_goal():
    store = InMemorySessionStore()
    session = CoachSession(
        session_id=SESSION_ID,
        practice_session_id=PRACTICE_SESSION_ID,
        summary_id=SUMMARY_ID,
        observation_pack=SUMMARY,
        actor=ACTOR,
        blockage_kind="분석",
        sub_branch="대사 분석",
        conversation_summary="상대를 붙잡으려는 장면으로 정리했다.",
        turns=[CoachTurn(role="ai", text="첫 말")],
    )

    store.create(session)
    loaded = store.get(SESSION_ID)

    assert loaded == session
    assert loaded.actor.goal == "상대가 멈추게 한다"
    assert loaded.conversation_summary == "상대를 붙잡으려는 장면으로 정리했다."
    assert set(loaded.turns[0].model_dump()) == {"role", "text"}
