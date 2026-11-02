"""구간 GOP 의 비교 범위(모델 없이 돈다, SOMA-967)."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import pronscore  # noqa: E402

# 음소 5개가 프레임 [2-3], [5], [8-9], [12], [15-16] 에 났다(총 20프레임).
SPANS = [[2, 3], [5, 5], [8, 9], [12, 12], [15, 16]]


def test_가운데_음소는_앞뒤_두_개와_그_바깥_빈_프레임까지_본다():
    assert pronscore._window(SPANS, 2, 20, width=1) == (1, 4, 4, 14)


def test_처음과_끝은_녹음_끝까지_본다():
    assert pronscore._window(SPANS, 0, 20, width=1) == (0, 2, 0, 7)
    assert pronscore._window(SPANS, 4, 20, width=1) == (3, 5, 10, 19)


def test_창이_음소열보다_넓으면_전체가_된다():
    assert pronscore._window(SPANS, 2, 20, width=9) == (0, 5, 0, 19)
