from uuid import UUID

from fastapi.testclient import TestClient

from acting_agent.config import Settings as AgentSettings
from acting_report.config import Settings as ReportSettings
from acting_summary import summarizer as summarizer_mod
from acting_summary.config import Settings as SummarySettings

from acting_api.app import create_app
from acting_api.config import GatewaySettings
from api_test_support import (
    COACH_FOLLOWUP,
    COACH_QUESTION,
    REPORT,
    SUMMARY,
    SUMMARY_ID,
    FakeClient,
    FakeGatewayStore,
    _Resp,
)

KEY = "test-key-1"
HDR = {"X-API-Key": KEY}


def _app(*, client=None, key_limits=None, clock=None, store=None):
    if store is None:
        if key_limits is None:
            key_limits = {KEY: 100}
        store = FakeGatewayStore(key_limits)
    kwargs = {}
    if clock is not None:
        kwargs["clock"] = clock
    app = create_app(
        client=client or FakeClient(),
        gateway_settings=GatewaySettings(
            database_url="postgresql+psycopg://unused/unused"
        ),
        summary_settings=SummarySettings(api_key="k", model="m"),
        agent_settings=AgentSettings(api_key="k", model="m"),
        report_settings=ReportSettings(api_key="k", model="m"),
        store=store,
        **kwargs,
    )
    return app


# ---- 인증 ----


def test_missing_key_401():
    c = TestClient(_app())
    assert c.get("/report/history/u1").status_code == 401


def test_wrong_key_401():
    c = TestClient(_app())
    r = c.get("/report/history/u1", headers={"X-API-Key": "nope"})
    assert r.status_code == 401


def test_valid_key_passes():
    c = TestClient(_app())
    r = c.get("/report/history/u1", headers=HDR)
    assert r.status_code == 200
    assert r.json()["count"] == 0


def test_key_missing_from_db_is_rejected():
    c = TestClient(_app(key_limits={}))
    assert c.get("/report/history/u1", headers=HDR).status_code == 401


def test_health_and_docs_exempt():
    c = TestClient(_app(key_limits={}))
    assert c.get("/health").status_code == 200
    assert c.get("/docs").status_code == 200
    assert c.get("/openapi.json").status_code == 200


# ---- rate limit ----


def test_rate_limit_429():
    c = TestClient(_app(key_limits={KEY: 2}))
    assert c.get("/report/history/u1", headers=HDR).status_code == 200
    assert c.get("/report/history/u1", headers=HDR).status_code == 200
    assert c.get("/report/history/u1", headers=HDR).status_code == 429


def test_rate_limit_per_key_uses_db_value():
    c = TestClient(_app(key_limits={KEY: 1, "key2": 2}))
    assert c.get("/report/history/u1", headers=HDR).status_code == 200
    assert c.get("/report/history/u1", headers=HDR).status_code == 429
    key2 = {"X-API-Key": "key2"}
    assert c.get("/report/history/u1", headers=key2).status_code == 200
    assert c.get("/report/history/u1", headers=key2).status_code == 200
    assert c.get("/report/history/u1", headers=key2).status_code == 429


def test_rate_limit_window_resets():
    now = {"value": 0.0}
    c = TestClient(_app(key_limits={KEY: 1}, clock=lambda: now["value"]))
    assert c.get("/report/history/u1", headers=HDR).status_code == 200
    assert c.get("/report/history/u1", headers=HDR).status_code == 429
    now["value"] = 61.0
    assert c.get("/report/history/u1", headers=HDR).status_code == 200


# ---- 라우팅 (세 서비스가 게이트웨이 하나에서 응답) ----


def test_health_lists_services():
    c = TestClient(_app())
    body = c.get("/health").json()
    assert body["status"] == "ok"
    assert set(body["services"]) == {"summary", "coach", "report"}


def test_summarize_via_gateway(monkeypatch):
    monkeypatch.setattr(summarizer_mod, "summarize", lambda *a, **k: SUMMARY)
    app = _app()
    c = TestClient(app)
    r = c.post(
        "/summarize",
        data={
            "user_id": "u1",
            "situation": "상황",
            "character": "인물",
            "subtext": "서브",
        },
        files={"video": ("t.mp4", b"bytes", "video/mp4")},
        headers=HDR,
    )
    assert r.status_code == 200
    assert r.json()["summary"] == SUMMARY.summary
    UUID(r.json()["summary_id"])


def test_summarize_requires_user_id(monkeypatch):
    monkeypatch.setattr(summarizer_mod, "summarize", lambda *a, **k: SUMMARY)
    c = TestClient(_app())
    r = c.post(
        "/summarize",
        data={"situation": "상황", "character": "인물", "subtext": "서브"},
        files={"video": ("t.mp4", b"bytes", "video/mp4")},
        headers=HDR,
    )
    assert r.status_code == 422


def test_coach_start_and_reply_via_gateway():
    store = FakeGatewayStore({KEY: 100})
    store.seed_summary()
    fake = FakeClient([_Resp(parsed=COACH_QUESTION), _Resp(parsed=COACH_FOLLOWUP)])
    c = TestClient(_app(client=fake, store=store))
    r = c.post("/coach/start", json={"summary_id": SUMMARY_ID}, headers=HDR)
    assert r.status_code == 200
    session_id = r.json()["session_id"]
    UUID(session_id)
    assert r.json()["utterance"] == COACH_QUESTION.utterance

    r2 = c.post(
        "/coach/reply",
        json={"session_id": session_id, "text": "대사가 기억 안 났어요"},
        headers=HDR,
    )
    assert r2.status_code == 200
    assert r2.json()["utterance"] == COACH_FOLLOWUP.utterance


def test_coach_start_rejects_legacy_full_summary():
    c = TestClient(_app())
    r = c.post(
        "/coach/start", json={"summary": SUMMARY.model_dump(mode="json")}, headers=HDR
    )
    assert r.status_code == 422


def test_report_via_gateway_derives_user_and_history_turns():
    store = FakeGatewayStore({KEY: 100})
    store.seed_summary(user_id="u1")
    fake = FakeClient(
        [
            _Resp(parsed=COACH_QUESTION),
            _Resp(parsed=REPORT),
        ]
    )
    c = TestClient(_app(client=fake, store=store))
    started = c.post("/coach/start", json={"summary_id": SUMMARY_ID}, headers=HDR)
    session_id = started.json()["session_id"]
    c.post(
        "/coach/reply",
        json={"session_id": session_id, "text": "그만할래"},
        headers=HDR,
    )

    r = c.post("/report", json={"session_id": session_id}, headers=HDR)
    assert r.status_code == 200
    assert r.json()["user_id"] == "u1"
    assert r.json()["report"]["headline"] == REPORT.headline
    assert r.json()["report_count"] == 1

    history = c.get("/report/history/u1", headers=HDR).json()
    assert history["count"] == 1
    assert [turn["role"] for turn in history["reports"][0]["turns"]] == [
        "ai",
        "actor",
        "ai",
    ]


def test_report_rejects_legacy_full_payload():
    c = TestClient(_app())
    r = c.post("/report", json={"user_id": "u1", "session": {}}, headers=HDR)
    assert r.status_code == 422
