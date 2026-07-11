import threading

from fastapi.testclient import TestClient

from acting_summary import summarizer as summarizer_mod
from acting_summary.app import create_app
from acting_summary.config import Settings
from acting_summary.schema import Anomaly, Observation, SceneSummary

FAKE = SceneSummary(
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
    key_moment="km",
    key_dimension="kd",
    anomalies=[
        Anomaly(
            start="00:01",
            end="00:02",
            dimension="대사",
            what="w",
            why_odd="o",
            likely_cause="c",
            impact_on_intent="ii",
            overlaps_key_moment=True,
            on_key_dimension=True,
            intent_impact="반전",
            severity="high",
            severity_reason="sr",
        )
    ],
)


def _app():
    return create_app(client=object(), settings=Settings(api_key="x", model="m"))


def test_health():
    c = TestClient(_app())
    r = c.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "model": "m"}


def test_summarize_endpoint(monkeypatch):
    def fake_summarize(video_path, subtext, *, client, model, **kw):
        assert subtext.situation == "상황"
        assert model == "m"
        return FAKE

    monkeypatch.setattr(summarizer_mod, "summarize", fake_summarize)
    c = TestClient(_app())
    r = c.post(
        "/summarize",
        data={"situation": "상황", "character": "인물", "subtext": "서브"},
        files={"video": ("t.mp4", b"bytes", "video/mp4")},
    )
    assert r.status_code == 200
    assert r.json()["summary"] == "s"
    assert r.json()["anomalies"][0]["start"] == "00:01"
    assert r.json()["anomalies"][0]["end"] == "00:02"


def test_summarize_does_not_block_event_loop(monkeypatch):
    # summarize가 도는 동안에도 /health가 응답해야 한다 (이벤트 루프 비블로킹)
    started = threading.Event()
    release = threading.Event()

    def slow_summarize(video_path, subtext, *, client, model, **kw):
        started.set()
        assert release.wait(timeout=10), "release never set"
        return FAKE

    monkeypatch.setattr(summarizer_mod, "summarize", slow_summarize)
    with TestClient(_app()) as c:
        post_result = {}

        def do_post():
            post_result["r"] = c.post(
                "/summarize",
                data={"situation": "a", "character": "b", "subtext": "c"},
                files={"video": ("t.mp4", b"bytes", "video/mp4")},
            )

        post_thread = threading.Thread(target=do_post, daemon=True)
        post_thread.start()
        assert started.wait(timeout=10), "summarize never started"

        health_result = {}

        def do_health():
            health_result["r"] = c.get("/health")

        health_thread = threading.Thread(target=do_health, daemon=True)
        health_thread.start()
        health_thread.join(timeout=3)
        health_ok = "r" in health_result and health_result["r"].status_code == 200

        release.set()
        post_thread.join(timeout=10)

    assert health_ok, "/health did not respond while summarize was in flight"
    assert post_result["r"].status_code == 200


def test_summarize_missing_video_422():
    c = TestClient(_app())
    r = c.post("/summarize", data={"situation": "a", "character": "b", "subtext": "c"})
    assert r.status_code == 422


def test_summarize_timeout_maps_504(monkeypatch):
    def boom(*a, **k):
        raise summarizer_mod.FileActiveTimeout("nope")

    monkeypatch.setattr(summarizer_mod, "summarize", boom)
    c = TestClient(_app())
    r = c.post(
        "/summarize",
        data={"situation": "a", "character": "b", "subtext": "c"},
        files={"video": ("t.mp4", b"bytes", "video/mp4")},
    )
    assert r.status_code == 504
