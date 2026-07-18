from acting_agent.guard import has_forbidden


def test_flags_forbidden_words():
    assert has_forbidden("연기력이 부족해 보여") is True
    assert has_forbidden("점수는 80점") is True


def test_allows_natural_observation_question():
    assert has_forbidden("약 얘기 꺼낼 때 목소리가 착 가라앉던데 — 왜 이렇게 나왔어?") is False
    assert has_forbidden("그 대사에서 사이를 길게 뒀더라. 의도한 거야?") is False


def test_flags_timestamps():
    assert has_forbidden("[00:12] 그 대사 뒤 1.2초 멈춤 — 왜 이렇게 나왔어?") is True
    assert has_forbidden("00:45-00:55 구간에서 낮게 말했어") is True


def test_flags_analysis_terms():
    assert has_forbidden("낮은 피치로 말했어") is True
    assert has_forbidden("그 구간에서 소리가 작아졌어") is True
    assert has_forbidden("severity가 높은 문제야") is True


def test_flags_banmal_judgment_conjugations():
    assert has_forbidden("그 표정 좋아 보여") is True
    assert has_forbidden("거긴 좀 나빠 보였어") is True
    assert has_forbidden("연기가 좋은데?") is True
