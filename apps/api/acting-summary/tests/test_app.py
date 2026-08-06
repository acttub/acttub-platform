import os
import threading
from uuid import UUID

from fastapi.testclient import TestClient

from acting_summary import summarizer as summarizer_mod
from acting_summary.app import create_app
from acting_summary.config import Settings
from acting_summary.schema import ObservationPack
from acting_summary.store import InMemorySummaryStore

PACK = ObservationPack(
    observations=[
        {"start_ms": 1, "end_ms": 2, "label": "대사가 시작된다", "confidence": 0.9}
    ],
    uncertainties=[],
)
FORM = {
    "user_id": "u",
    "situation": "상황",
    "character": "인물",
    "goal": "상대가 멈추게 한다",
    "blockage_kind": "분석",
    "blockage_detail": "왜 지금 말하는지 모르겠다",
    "duration_ms": "1000",
}


def _app(store=None):
    return create_app(
        client=object(),
        settings=Settings(api_key="x", model="m"),
        store=store or InMemorySummaryStore(),
    )


def test_health():
    response = TestClient(_app()).get("/health")
    assert response.json() == {"status": "ok", "model": "m"}


def test_summarize_endpoint_uses_goal_actor_material(monkeypatch):
    def fake_summarize(video_path, actor, *, client, model, **kwargs):
        assert actor.situation == "상황"
        assert actor.goal == "상대가 멈추게 한다"
        assert actor.blockage_kind == "분석"
        assert actor.duration_ms == 1000
        return PACK

    monkeypatch.setattr(summarizer_mod, "summarize", fake_summarize)
    store = InMemorySummaryStore()
    response = TestClient(_app(store)).post(
        "/summarize",
        data=FORM,
        files={"video": ("take.mp4", b"bytes", "video/mp4")},
    )

    assert response.status_code == 200
    assert response.json()["observations"][0]["label"] == "대사가 시작된다"
    summary_id = response.json()["summary_id"]
    assert str(UUID(summary_id)) == summary_id
    record = store.records[summary_id]
    assert record["actor"].goal == "상대가 멈추게 한다"
    assert record["observation_pack"] == PACK
    assert record["video_filename"] == "take.mp4"


def test_summarize_does_not_block_event_loop(monkeypatch):
    started = threading.Event()
    release = threading.Event()

    def slow_summarize(*args, **kwargs):
        started.set()
        assert release.wait(timeout=10)
        return PACK

    monkeypatch.setattr(summarizer_mod, "summarize", slow_summarize)
    with TestClient(_app()) as client:
        post_result = {}
        thread = threading.Thread(
            target=lambda: post_result.setdefault(
                "response",
                client.post(
                    "/summarize",
                    data=FORM,
                    files={"video": ("take.mp4", b"bytes", "video/mp4")},
                ),
            ),
            daemon=True,
        )
        thread.start()
        assert started.wait(timeout=10)
        health = client.get("/health")
        release.set()
        thread.join(timeout=10)

    assert health.status_code == 200
    assert post_result["response"].status_code == 200


def test_required_form_fields_are_enforced():
    client = TestClient(_app())
    assert client.post("/summarize", data=FORM).status_code == 422
    no_goal = {key: value for key, value in FORM.items() if key != "goal"}
    assert (
        client.post(
            "/summarize",
            data=no_goal,
            files={"video": ("take.mp4", b"bytes", "video/mp4")},
        ).status_code
        == 422
    )


def test_timeout_maps_to_504(monkeypatch):
    def fail(*args, **kwargs):
        raise summarizer_mod.FileActiveTimeout("nope")

    monkeypatch.setattr(summarizer_mod, "summarize", fail)
    response = TestClient(_app()).post(
        "/summarize",
        data=FORM,
        files={"video": ("take.mp4", b"bytes", "video/mp4")},
    )
    assert response.status_code == 504


def test_compressed_and_original_files_are_cleaned(monkeypatch, tmp_path):
    from acting_summary import compress as compress_mod

    compressed = tmp_path / "small.gemini.mp4"
    seen = {}

    def fake_compress(video_path, **kwargs):
        seen["original"] = video_path
        compressed.write_bytes(b"tiny")
        return str(compressed)

    def fake_summarize(video_path, actor, **kwargs):
        seen["sent"] = video_path
        return PACK

    monkeypatch.setattr(compress_mod, "compress_for_gemini", fake_compress)
    monkeypatch.setattr(summarizer_mod, "summarize", fake_summarize)
    response = TestClient(_app()).post(
        "/summarize",
        data=FORM,
        files={"video": ("take.mp4", b"x" * 100, "video/mp4")},
    )

    assert response.status_code == 200
    assert seen["sent"] == str(compressed)
    assert not os.path.exists(seen["original"])
    assert not compressed.exists()


def test_oversized_upload_is_rejected_before_analysis(monkeypatch):
    from acting_summary import router as router_mod

    monkeypatch.setattr(router_mod, "MAX_UPLOAD_BYTES", 50)
    monkeypatch.setattr(
        summarizer_mod,
        "summarize",
        lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError()),
    )
    response = TestClient(_app()).post(
        "/summarize",
        data=FORM,
        files={"video": ("take.mp4", b"x" * 200, "video/mp4")},
    )
    assert response.status_code == 413


def test_upload_is_streamed_to_disk(monkeypatch):
    seen = {}

    def fake_summarize(video_path, actor, **kwargs):
        seen["size"] = os.path.getsize(video_path)
        return PACK

    monkeypatch.setattr(summarizer_mod, "summarize", fake_summarize)
    body = b"x" * (3 * 1024 * 1024)
    response = TestClient(_app()).post(
        "/summarize",
        data=FORM,
        files={"video": ("take.mp4", body, "video/mp4")},
    )
    assert response.status_code == 200
    assert seen["size"] == len(body)
