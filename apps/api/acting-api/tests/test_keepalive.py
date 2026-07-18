import asyncio

import pytest
from fastapi.testclient import TestClient

from acting_agent.config import Settings as AgentSettings
from acting_report.config import Settings as ReportSettings
from acting_summary.config import Settings as SummarySettings

from acting_api.app import create_app
from acting_api.config import GatewaySettings, load_gateway_settings
from acting_api.keepalive import keep_alive_loop
from api_test_support import FakeClient
from platform_test_support import FakePlatformStore


# ---- 설정 파싱 ----


def test_keep_alive_env_parsed(monkeypatch, tmp_path):
    monkeypatch.setenv("DATABASE_URL", "postgresql://localhost/acting")
    monkeypatch.setenv("JWT_SECRET", "test-jwt-secret")
    monkeypatch.setenv("KEEP_ALIVE_URL", "https://acting-api.onrender.com")
    monkeypatch.setenv("KEEP_ALIVE_INTERVAL_SEC", "300")
    s = load_gateway_settings(env_path=tmp_path / "missing.env")
    assert s.database_url == "postgresql+psycopg://localhost/acting"
    assert s.keep_alive_url == "https://acting-api.onrender.com"
    assert s.keep_alive_interval_sec == 300


def test_keep_alive_defaults_off(monkeypatch, tmp_path):
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://localhost/acting")
    monkeypatch.setenv("JWT_SECRET", "test-jwt-secret")
    monkeypatch.delenv("KEEP_ALIVE_URL", raising=False)
    monkeypatch.delenv("KEEP_ALIVE_INTERVAL_SEC", raising=False)
    s = load_gateway_settings(env_path=tmp_path / "missing.env")
    assert s.keep_alive_url is None
    assert s.keep_alive_interval_sec == 600


def test_database_url_is_required(monkeypatch, tmp_path):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    with pytest.raises(RuntimeError, match="DATABASE_URL"):
        load_gateway_settings(env_path=tmp_path / "missing.env")


# ---- ping 루프 ----


class FakeHttp:
    def __init__(self, error=None):
        self.calls = []
        self.error = error

    async def get(self, url):
        self.calls.append(url)
        if self.error:
            raise self.error


def _run_loop(http, n_sleeps, url="https://x.example/", interval=600):
    sleeps = []

    async def fake_sleep(sec):
        sleeps.append(sec)
        if len(sleeps) >= n_sleeps:
            raise asyncio.CancelledError

    with pytest.raises(asyncio.CancelledError):
        asyncio.run(keep_alive_loop(url, interval, http, sleep=fake_sleep))
    return sleeps


def test_loop_pings_health_each_interval():
    http = FakeHttp()
    sleeps = _run_loop(http, n_sleeps=3)
    assert http.calls == ["https://x.example/health"] * 2
    assert sleeps == [600, 600, 600]


def test_loop_survives_ping_error():
    http = FakeHttp(error=RuntimeError("boom"))
    _run_loop(http, n_sleeps=3)
    assert len(http.calls) == 2  # 에러에도 루프 계속


# ---- 앱 연결 ----


def _app(*, keep_alive_url=None, keep_alive_client=None):
    return create_app(
        client=FakeClient(),
        gateway_settings=GatewaySettings(
            database_url="postgresql+psycopg://unused/unused",
            jwt_secret="test-jwt-secret",
            keep_alive_url=keep_alive_url,
        ),
        summary_settings=SummarySettings(api_key="k", model="m"),
        agent_settings=AgentSettings(api_key="k", model="m"),
        report_settings=ReportSettings(api_key="k", model="m"),
        store=FakePlatformStore(),
        keep_alive_client=keep_alive_client,
    )


def test_task_not_started_without_url():
    app = _app()
    with TestClient(app) as c:
        assert app.state.keep_alive_task is None
        assert c.get("/health").json()["keep_alive"] is False


def test_task_started_and_cancelled_with_url():
    app = _app(
        keep_alive_url="https://x.example",
        keep_alive_client=FakeHttp(),
    )
    with TestClient(app) as c:
        task = app.state.keep_alive_task
        assert task is not None
        assert not task.done()
        assert c.get("/health").json()["keep_alive"] is True
    assert task.cancelled()
