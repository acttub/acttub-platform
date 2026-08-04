from acting_agent import engine
from acting_agent.config import DEFAULT_MAX_QUESTIONS, Settings, load_settings


# 엔진과 설정이 상한을 따로 들고 있으면 테스트는 한 값으로, 운영은 다른 값으로 돈다.
def test_engine_and_config_share_one_limit():
    assert engine.MAX_QUESTIONS == DEFAULT_MAX_QUESTIONS


# 수렴 구간이 상한보다 크면 첫 질문부터 수렴이 켜져 대화가 열리지 않는다.
def test_converge_margin_leaves_room_to_open_the_talk():
    assert 0 < engine.CONVERGE_MARGIN < engine.MAX_QUESTIONS


def test_max_questions_default_is_8(monkeypatch, tmp_path):
    monkeypatch.setenv("GEMINI_API_KEY", "k")
    monkeypatch.delenv("COACH_MAX_QUESTIONS", raising=False)
    s = load_settings(env_path=tmp_path / "no.env")
    assert s.max_questions == 8


def test_max_questions_env_override(monkeypatch, tmp_path):
    monkeypatch.setenv("GEMINI_API_KEY", "k")
    monkeypatch.setenv("COACH_MAX_QUESTIONS", "5")
    s = load_settings(env_path=tmp_path / "no.env")
    assert s.max_questions == 5


def test_settings_dataclass_default():
    assert Settings(api_key="k", model="m").max_questions == 8
