from pathlib import Path

import pytest

from acting_api import config
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


def test_consent_docs_dir_uses_project_default(monkeypatch, tmp_path):
    monkeypatch.setenv("DATABASE_URL", "postgresql://user:pass@db.example/acting")
    monkeypatch.setenv("JWT_SECRET", "secret")
    monkeypatch.delenv("CONSENT_DOCS_DIR", raising=False)

    settings = load_gateway_settings(tmp_path / "missing.env")

    assert settings.consent_docs_dir == (
        Path(config.__file__).resolve().parents[2] / "consent_docs"
    )


def test_consent_docs_dir_env_overrides_default(monkeypatch, tmp_path):
    monkeypatch.setenv("DATABASE_URL", "postgresql://user:pass@db.example/acting")
    monkeypatch.setenv("JWT_SECRET", "secret")
    monkeypatch.setenv("CONSENT_DOCS_DIR", str(tmp_path / "custom-consents"))

    settings = load_gateway_settings(tmp_path / "missing.env")

    assert settings.consent_docs_dir == (tmp_path / "custom-consents").resolve()


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


def test_s3_bucket_and_region_enable_storage_without_access_keys(
    monkeypatch, tmp_path
):
    monkeypatch.setenv("DATABASE_URL", "postgresql://user:pass@db.example/acting")
    monkeypatch.setenv("JWT_SECRET", "secret")
    monkeypatch.setenv("S3_BUCKET", "acting-videos")
    monkeypatch.setenv("AWS_REGION", "ap-northeast-2")
    monkeypatch.delenv("AWS_ACCESS_KEY_ID", raising=False)
    monkeypatch.delenv("AWS_SECRET_ACCESS_KEY", raising=False)
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


@pytest.mark.parametrize(
    ("configured_name", "configured_value"),
    [
        ("S3_BUCKET", "acting-videos"),
        ("AWS_REGION", "ap-northeast-2"),
    ],
)
def test_bucket_or_region_without_the_other_fails_fast(
    monkeypatch, tmp_path, configured_name, configured_value
):
    monkeypatch.setenv("DATABASE_URL", "postgresql://user:pass@db.example/acting")
    monkeypatch.setenv("JWT_SECRET", "secret")
    monkeypatch.delenv("S3_BUCKET", raising=False)
    monkeypatch.delenv("AWS_REGION", raising=False)
    monkeypatch.delenv("AWS_ACCESS_KEY_ID", raising=False)
    monkeypatch.delenv("AWS_SECRET_ACCESS_KEY", raising=False)
    monkeypatch.setenv(configured_name, configured_value)

    with pytest.raises(
        RuntimeError, match="S3_BUCKET and AWS_REGION must be configured together"
    ):
        load_gateway_settings(tmp_path / "missing.env")


@pytest.mark.parametrize(
    ("configured_name", "configured_value"),
    [
        ("AWS_ACCESS_KEY_ID", "access"),
        ("AWS_SECRET_ACCESS_KEY", "secret-key"),
    ],
)
def test_half_configured_access_key_pair_fails_fast(
    monkeypatch, tmp_path, configured_name, configured_value
):
    monkeypatch.setenv("DATABASE_URL", "postgresql://user:pass@db.example/acting")
    monkeypatch.setenv("JWT_SECRET", "secret")
    monkeypatch.delenv("S3_BUCKET", raising=False)
    monkeypatch.delenv("AWS_REGION", raising=False)
    monkeypatch.delenv("AWS_ACCESS_KEY_ID", raising=False)
    monkeypatch.delenv("AWS_SECRET_ACCESS_KEY", raising=False)
    monkeypatch.setenv(configured_name, configured_value)

    with pytest.raises(
        RuntimeError,
        match="AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY must be configured together",
    ):
        load_gateway_settings(tmp_path / "missing.env")


def test_access_key_pair_without_s3_bucket_and_region_is_ignored(
    monkeypatch, tmp_path
):
    monkeypatch.setenv("DATABASE_URL", "postgresql://user:pass@db.example/acting")
    monkeypatch.setenv("JWT_SECRET", "secret")
    monkeypatch.delenv("S3_BUCKET", raising=False)
    monkeypatch.delenv("AWS_REGION", raising=False)
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "access")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "secret-key")

    settings = load_gateway_settings(tmp_path / "missing.env")

    assert settings.s3_configured is False
