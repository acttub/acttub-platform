import pytest

from acting_llm.forbidden import scan_forbidden


@pytest.mark.parametrize("term", ["점수", "더 자연스럽게", "진심으로"])
def test_literal_forbidden_terms_are_detected(term):
    assert scan_forbidden(f"이 문장에는 {term} 표현이 있습니다.") == [term]


def test_normal_coaching_sentence_is_allowed():
    assert scan_forbidden("그 대사를 천천히 말하고 상대의 반응을 살펴보세요.") == []
