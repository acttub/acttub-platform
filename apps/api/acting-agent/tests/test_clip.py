from acting_agent.clip import pick_target
from agent_test_support import SUMMARY


def test_pick_target_returns_top_severity():
    target = pick_target(SUMMARY)
    assert target is not None
    assert target.severity == "high" and target.start == "00:12"


def test_pick_target_none_when_empty():
    empty = SUMMARY.model_copy(update={"anomalies": []})
    assert pick_target(empty) is None
