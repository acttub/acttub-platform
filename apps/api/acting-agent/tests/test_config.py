from acting_agent.config import Settings, load_settings


def test_max_questions_default_is_10(monkeypatch, tmp_path):
    monkeypatch.setenv("GEMINI_API_KEY", "k")
    monkeypatch.delenv("COACH_MAX_QUESTIONS", raising=False)
    s = load_settings(env_path=tmp_path / "no.env")
    assert s.max_questions == 10


def test_max_questions_env_override(monkeypatch, tmp_path):
    monkeypatch.setenv("GEMINI_API_KEY", "k")
    monkeypatch.setenv("COACH_MAX_QUESTIONS", "5")
    s = load_settings(env_path=tmp_path / "no.env")
    assert s.max_questions == 5


def test_settings_dataclass_default():
    assert Settings(api_key="k", model="m").max_questions == 10
