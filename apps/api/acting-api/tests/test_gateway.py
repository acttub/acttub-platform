from fastapi.testclient import TestClient

from acting_agent.config import Settings as AgentSettings
from acting_report.config import Settings as ReportSettings
from acting_report.store import FileReportStore
from acting_summary import summarizer as summarizer_mod
from acting_summary.config import Settings as SummarySettings

from acting_api.app import create_app
from acting_api.config import GatewaySettings
from support import (
    AGENT_SUMMARY,
    COACH_FOLLOWUP,
    COACH_QUESTION,
    REPORT,
    REPORT_SESSION,
    FakeClient,
    _Resp,
)

KEY = "test-key-1"
HDR = {"X-API-Key": KEY}


def _app(tmp_path, *, client=None, api_keys=(KEY,), limit=100, clock=None):
    kwargs = {}
    if clock is not None:
        kwargs["clock"] = clock
    return create_app(
        client=client or FakeClient(),
        gateway_settings=GatewaySettings(api_keys=api_keys, rate_limit_per_min=limit),
        summary_settings=SummarySettings(api_key="k", model="m"),
        agent_settings=AgentSettings(api_key="k", model="m"),
        report_settings=ReportSettings(api_key="k", model="m"),
        report_store=FileReportStore(tmp_path / "reports.json"),
        **kwargs,
    )


# ---- 인증 ----


def test_missing_key_401(tmp_path):
    c = TestClient(_app(tmp_path))
    assert c.get("/report/history/u1").status_code == 401


def test_wrong_key_401(tmp_path):
    c = TestClient(_app(tmp_path))
    r = c.get("/report/history/u1", headers={"X-API-Key": "nope"})
    assert r.status_code == 401


def test_valid_key_passes(tmp_path):
    c = TestClient(_app(tmp_path))
    r = c.get("/report/history/u1", headers=HDR)
    assert r.status_code == 200
    assert r.json()["count"] == 0


def test_no_keys_configured_fail_closed(tmp_path):
    c = TestClient(_app(tmp_path, api_keys=()))
    assert c.get("/report/history/u1", headers=HDR).status_code == 503


def test_health_and_docs_exempt(tmp_path):
    c = TestClient(_app(tmp_path))
    assert c.get("/health").status_code == 200
    assert c.get("/docs").status_code == 200
    assert c.get("/openapi.json").status_code == 200


# ---- rate limit ----


def test_rate_limit_429(tmp_path):
    c = TestClient(_app(tmp_path, limit=2))
    assert c.get("/report/history/u1", headers=HDR).status_code == 200
    assert c.get("/report/history/u1", headers=HDR).status_code == 200
    assert c.get("/report/history/u1", headers=HDR).status_code == 429


def test_rate_limit_per_key(tmp_path):
    c = TestClient(_app(tmp_path, api_keys=(KEY, "key2"), limit=1))
    assert c.get("/report/history/u1", headers=HDR).status_code == 200
    assert c.get("/report/history/u1", headers=HDR).status_code == 429
    assert c.get("/report/history/u1", headers={"X-API-Key": "key2"}).status_code == 200


def test_rate_limit_window_resets(tmp_path):
    t = {"now": 0.0}
    c = TestClient(_app(tmp_path, limit=1, clock=lambda: t["now"]))
    assert c.get("/report/history/u1", headers=HDR).status_code == 200
    assert c.get("/report/history/u1", headers=HDR).status_code == 429
    t["now"] = 61.0
    assert c.get("/report/history/u1", headers=HDR).status_code == 200


# ---- 라우팅 (세 서비스가 게이트웨이 하나에서 응답) ----


def test_health_lists_services(tmp_path):
    c = TestClient(_app(tmp_path))
    body = c.get("/health").json()
    assert body["status"] == "ok"
    assert set(body["services"]) == {"summary", "coach", "report"}


def test_summarize_via_gateway(tmp_path, monkeypatch):
    monkeypatch.setattr(summarizer_mod, "summarize", lambda *a, **k: {"summary": "ok"})
    c = TestClient(_app(tmp_path))
    r = c.post(
        "/summarize",
        data={"situation": "상황", "character": "인물", "subtext": "서브"},
        files={"video": ("t.mp4", b"bytes", "video/mp4")},
        headers=HDR,
    )
    assert r.status_code == 200
    assert r.json()["summary"] == "ok"


def test_coach_start_and_reply_via_gateway(tmp_path):
    fake = FakeClient([_Resp(parsed=COACH_QUESTION), _Resp(parsed=COACH_FOLLOWUP)])
    c = TestClient(_app(tmp_path, client=fake))
    r = c.post(
        "/coach/start", json={"summary": AGENT_SUMMARY.model_dump()}, headers=HDR
    )
    assert r.status_code == 200
    sid = r.json()["session_id"]
    assert r.json()["utterance"] == COACH_QUESTION.utterance

    r2 = c.post(
        "/coach/reply",
        json={"session_id": sid, "text": "대사가 기억 안 났어요"},
        headers=HDR,
    )
    assert r2.status_code == 200
    assert r2.json()["utterance"] == COACH_FOLLOWUP.utterance


def test_report_via_gateway(tmp_path):
    fake = FakeClient([_Resp(parsed=REPORT)])
    c = TestClient(_app(tmp_path, client=fake))
    r = c.post(
        "/report",
        json={"user_id": "u1", "session": REPORT_SESSION.model_dump()},
        headers=HDR,
    )
    assert r.status_code == 200
    assert r.json()["report"]["headline"] == REPORT.headline
    h = c.get("/report/history/u1", headers=HDR)
    assert h.json()["count"] == 1
