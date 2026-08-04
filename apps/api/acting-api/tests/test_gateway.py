import logging
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from acting_agent.config import Settings as AgentSettings
from acting_api.app import create_app
from acting_api.config import GatewaySettings
from acting_report.config import Settings as ReportSettings
from acting_summary.config import Settings as SummarySettings
from api_test_support import FakeClient
from platform_test_support import FakePlatformStore


def _app(*, gateway_settings=None):
    return create_app(
        client=FakeClient(),
        gateway_settings=(
            gateway_settings
            or GatewaySettings(
                database_url="postgresql+psycopg://unused/unused",
                jwt_secret="test-jwt-secret",
            )
        ),
        summary_settings=SummarySettings(api_key="k", model="m"),
        agent_settings=AgentSettings(api_key="k", model="m"),
        report_settings=ReportSettings(api_key="k", model="m"),
        store=FakePlatformStore(),
    )


class FakeBotoSession:
    def __init__(self, credentials):
        self.credentials = credentials
        self.get_credentials_calls = 0
        self.client_calls = []
        self.s3_client = object()

    def get_credentials(self):
        self.get_credentials_calls += 1
        return self.credentials

    def client(self, service_name, **kwargs):
        self.client_calls.append((service_name, kwargs))
        return self.s3_client


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


def test_s3_startup_fails_when_default_chain_has_no_credentials(monkeypatch):
    session = FakeBotoSession(credentials=None)
    monkeypatch.setattr("acting_api.app.boto3.Session", lambda: session)
    settings = GatewaySettings(
        database_url="postgresql+psycopg://unused/unused",
        jwt_secret="test-jwt-secret",
        s3_bucket="videos",
        aws_region="ap-northeast-2",
    )

    with pytest.raises(RuntimeError, match="S3 credentials could not be resolved"):
        _app(gateway_settings=settings)

    assert session.get_credentials_calls == 1
    assert session.client_calls == []


def test_s3_uses_one_session_for_credential_check_and_client_creation(
    monkeypatch, caplog
):
    session = FakeBotoSession(credentials=SimpleNamespace(method="iam-role"))
    session_factories = []

    def build_session():
        session_factories.append(session)
        return session

    monkeypatch.setattr("acting_api.app.boto3.Session", build_session)
    settings = GatewaySettings(
        database_url="postgresql+psycopg://unused/unused",
        jwt_secret="test-jwt-secret",
        s3_bucket="videos",
        aws_access_key_id="rollback-access-key",
        aws_secret_access_key="rollback-secret-key",
        aws_region="ap-northeast-2",
    )

    with caplog.at_level(logging.INFO, logger="acting_api.app"):
        app = _app(gateway_settings=settings)

    assert session_factories == [session]
    assert session.get_credentials_calls == 1
    assert session.client_calls == [
        (
            "s3",
            {
                "region_name": "ap-northeast-2",
                "endpoint_url": "https://s3.ap-northeast-2.amazonaws.com",
            },
        )
    ]
    assert app.state.s3_storage._client is session.s3_client
    assert "S3 credential method=iam-role" in caplog.text
