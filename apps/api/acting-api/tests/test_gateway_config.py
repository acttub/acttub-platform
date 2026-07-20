import pytest

from acting_api.config import load_gateway_settings


def test_gateway_settings_fail_fast_when_jwt_secret_is_missing(monkeypatch, tmp_path):
    monkeypatch.setenv("DATABASE_URL", "postgresql://user:pass@db.example/acting")
    monkeypatch.delenv("JWT_SECRET", raising=False)
    with pytest.raises(RuntimeError, match="JWT_SECRET not configured"):
        load_gateway_settings(tmp_path / "missing.env")


def test_google_client_id_uses_code_default(monkeypatch, tmp_path):
    monkeypatch.setenv("DATABASE_URL", "postgresql://user:pass@db.example/acting")
    monkeypatch.setenv("JWT_SECRET", "secret")
    monkeypatch.delenv("GOOGLE_OAUTH_CLIENT_ID", raising=False)
    settings = load_gateway_settings(tmp_path / "missing.env")
    assert settings.jwt_secret == "secret"
    assert settings.google_oauth_client_id == (
        "462651930952-625pcnhrjib79r7990fqsdqhsterdij2."
        "apps.googleusercontent.com"
    )


def test_google_client_id_env_overrides_code_default(monkeypatch, tmp_path):
    monkeypatch.setenv("DATABASE_URL", "postgresql://user:pass@db.example/acting")
    monkeypatch.setenv("JWT_SECRET", "secret")
    monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_ID", "override-client-id")

    settings = load_gateway_settings(tmp_path / "missing.env")

    assert settings.google_oauth_client_id == "override-client-id"


@pytest.mark.parametrize("value", ["1", "true", "TRUE", " true "])
def test_development_auth_provider_truthy_values_enable_flag(
    monkeypatch, tmp_path, value
):
    monkeypatch.setenv("DATABASE_URL", "postgresql://user:pass@db.example/acting")
    monkeypatch.setenv("JWT_SECRET", "secret")
    monkeypatch.setenv("DEVELOPMENT_AUTH_PROVIDER", value)

    settings = load_gateway_settings(tmp_path / "missing.env")

    assert settings.development_auth_provider is True


@pytest.mark.parametrize("value", [None, "0", "false", "yes"])
def test_development_auth_provider_is_disabled_by_default(
    monkeypatch, tmp_path, value
):
    monkeypatch.setenv("DATABASE_URL", "postgresql://user:pass@db.example/acting")
    monkeypatch.setenv("JWT_SECRET", "secret")
    if value is None:
        monkeypatch.delenv("DEVELOPMENT_AUTH_PROVIDER", raising=False)
    else:
        monkeypatch.setenv("DEVELOPMENT_AUTH_PROVIDER", value)

    settings = load_gateway_settings(tmp_path / "missing.env")

    assert settings.development_auth_provider is False


def test_default_analysis_lease_covers_download_compression_and_gemini_wait(
    monkeypatch, tmp_path
):
    monkeypatch.setenv("DATABASE_URL", "postgresql://user:pass@db.example/acting")
    monkeypatch.setenv("JWT_SECRET", "secret")
    monkeypatch.delenv("ANALYSIS_LEASE_SEC", raising=False)

    settings = load_gateway_settings(tmp_path / "missing.env")

    assert settings.analysis_lease_sec == 1800


def test_s3_and_worker_settings_are_parsed_together(monkeypatch, tmp_path):
    monkeypatch.setenv("DATABASE_URL", "postgresql://user:pass@db.example/acting")
    monkeypatch.setenv("JWT_SECRET", "secret")
    monkeypatch.setenv("S3_BUCKET", "acting-videos")
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "access")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "secret-key")
    monkeypatch.setenv("AWS_REGION", "ap-northeast-2")
    monkeypatch.setenv("ANALYSIS_WORKER_CONCURRENCY", "2")
    monkeypatch.setenv("ANALYSIS_WORKER_POLL_INTERVAL_SEC", "3.5")
    monkeypatch.setenv("ANALYSIS_LEASE_SEC", "900")
    monkeypatch.setenv("ANALYSIS_SWEEP_INTERVAL_SEC", "45")
    settings = load_gateway_settings(tmp_path / "missing.env")
    assert settings.s3_configured is True
    assert settings.s3_bucket == "acting-videos"
    assert settings.aws_region == "ap-northeast-2"
    assert settings.analysis_worker_concurrency == 2
    assert settings.analysis_worker_poll_interval_sec == 3.5
    assert settings.analysis_lease_sec == 900
    assert settings.analysis_sweep_interval_sec == 45


def test_partial_s3_configuration_fails_fast(monkeypatch, tmp_path):
    monkeypatch.setenv("DATABASE_URL", "postgresql://user:pass@db.example/acting")
    monkeypatch.setenv("JWT_SECRET", "secret")
    monkeypatch.setenv("S3_BUCKET", "acting-videos")
    monkeypatch.delenv("AWS_ACCESS_KEY_ID", raising=False)
    monkeypatch.delenv("AWS_SECRET_ACCESS_KEY", raising=False)
    monkeypatch.delenv("AWS_REGION", raising=False)
    with pytest.raises(RuntimeError, match="must be configured together"):
        load_gateway_settings(tmp_path / "missing.env")
