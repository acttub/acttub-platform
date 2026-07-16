from acting_agent.clip import build_clip_html, pick_target
from agent_test_support import SUMMARY


def test_pick_target_returns_top_severity():
    target = pick_target(SUMMARY)
    assert target is not None
    assert target.severity == "high" and target.start == "00:12"


def test_pick_target_none_when_empty():
    empty = SUMMARY.model_copy(update={"anomalies": []})
    assert pick_target(empty) is None


def test_build_clip_html_plays_video():
    html = build_clip_html("/gradio_api/file=v.mp4")
    assert "<video" in html and "controls" in html
    assert 'src="/gradio_api/file=v.mp4"' in html
