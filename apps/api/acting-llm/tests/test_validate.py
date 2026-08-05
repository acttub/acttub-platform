import pytest

from acting_llm.validate import has_timecode, validate_turn, visible_length


@pytest.mark.parametrize("text", ["00:17에서 다시 시작해요.", "3초에서 5초를 봐요."])
def test_timecode_is_detected(text):
    assert has_timecode(text)


def test_duration_is_not_a_timecode():
    assert not has_timecode("2초 동안 기다려")


def test_visible_length_normalizes_whitespace():
    assert visible_length("  하나\n\t둘  ") == len("하나 둘")


def test_sentence_limit_boundary():
    assert validate_turn("가" * 170).checks["sentence_limit"]
    over_limit = validate_turn("가" * 171)
    assert not over_limit.checks["sentence_limit"]
    assert over_limit.failures == ["응답이 171자입니다. 170자 이내여야 합니다."]


def test_sentence_limit_can_be_disabled():
    result = validate_turn("가" * 171, enforce_sentence_limit=False)
    assert result.checks["sentence_limit"]
    assert result.failures == []


def test_validation_has_exactly_three_checks():
    assert tuple(validate_turn("한 번 말해보세요.").checks) == (
        "sentence_limit",
        "forbidden_language",
        "timecode",
    )
