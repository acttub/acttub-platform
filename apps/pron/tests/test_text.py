import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import pronscore as P  # noqa: E402


def test_numbers_read_in_korean():
    assert P.normalize("사과상자로 한 60개 들어가더라고요. 10억씩.") == "사과상자로 한 육십개 들어가더라고요. 십억씩."
    assert P.normalize("6시에 봐") == "여섯시에 봐"
    assert P.normalize("600억이요") == "육백억이요"


def test_directions_removed_and_number_words_marked():
    assert P.normalize("(웃으며) 그래요") == "그래요"
    assert P.number_words("(웃으며) 한 60개 들어가") == {1}


def test_standard_pronunciation_rules():
    assert [w for w, _ in P.phonemes("국물 신라")] == ["국물", "신라"]
    _, ph = P.phonemes("국물")[0]
    assert ph[2] == "NG"  # 비음화: 국→궁
    _, ph = P.phonemes("신라")[0]
    assert ph[2] == "L" and ph[3] == "R"  # 유음화: 신라→실라


def test_flag_rules():
    base = {"weak": False, "lpr": -5.0}
    assert P.flagged({**base, "ph": "R", "alt": "N"})
    assert not P.flagged({**base, "ph": "R", "alt": "H"})  # 자연스러운 변이
    assert not P.flagged({**base, "ph": "A", "alt": "N"})  # 모음↔자음
    assert not P.flagged({**base, "ph": "R", "alt": "N", "lpr": -2.0})
