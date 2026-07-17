from fastapi.testclient import TestClient

from acting_agent.config import Settings as AgentSettings
from acting_api.app import create_app
from acting_api.config import GatewaySettings
from acting_report.config import Settings as ReportSettings
from acting_summary.config import Settings as SummarySettings
from api_test_support import FakeClient
from platform_test_support import FakePlatformStore


def _app():
    return create_app(
        client=FakeClient(),
        gateway_settings=GatewaySettings(
            database_url="postgresql+psycopg://unused/unused",
            jwt_secret="test-jwt-secret",
        ),
        summary_settings=SummarySettings(api_key="k", model="m"),
        agent_settings=AgentSettings(api_key="k", model="m"),
        report_settings=ReportSettings(api_key="k", model="m"),
        store=FakePlatformStore(),
    )


def test_health_and_api_documentation_remain_public():
    client = TestClient(_app())
    assert client.get("/health").status_code == 200
    assert client.get("/docs").status_code == 200
    assert client.get("/openapi.json").status_code == 200


def test_v1_routes_are_removed_even_when_x_api_key_is_sent():
    client = TestClient(_app())
    headers = {"X-API-Key": "legacy-key"}
    requests = [
        client.post("/summarize", headers=headers),
        client.post("/coach/start", headers=headers),
        client.post("/coach/reply", headers=headers),
        client.post("/report", headers=headers),
        client.get("/report/history/legacy-user", headers=headers),
    ]
    assert [response.status_code for response in requests] == [404] * 5
