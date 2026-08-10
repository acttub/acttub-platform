from pathlib import Path

import pytest

from acting_summary.config import DEFAULT_MODEL, Settings, load_settings


def test_load_settings_reads_key_and_default_model(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.delenv("GEMINI_MODEL", raising=False)
    settings = load_settings(env_path=Path("does-not-exist.env"))
    assert isinstance(settings, Settings)
    assert settings.api_key == "test-key"
    assert settings.model == "gemini-3-flash-preview"


def test_default_model_matches_production():
    # 운영 /etc/acttub/api.env 의 GEMINI_MODEL 과 같은 값. 다르면 환경변수가 빠졌을 때
    # 아무 표시 없이 다른 모델로 분석한다.
    assert DEFAULT_MODEL == "gemini-3-flash-preview"


def test_load_settings_model_override(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setenv("GEMINI_MODEL", "gemini-2.5-pro")
    settings = load_settings(env_path=Path("does-not-exist.env"))
    assert settings.model == "gemini-2.5-pro"


def test_load_settings_missing_key_raises(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    with pytest.raises(RuntimeError):
        load_settings(env_path=Path("does-not-exist.env"))
