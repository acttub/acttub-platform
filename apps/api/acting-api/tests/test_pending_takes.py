"""지난 연습 카드에서 "해보기로 했지만 아직 안 해본 것" 을 꺼낸다.

카드에는 해본 것과 안 해본 것이 `tested` 로 구분돼 있다. 다음 연습에서 물어볼
거리는 **안 해본 것**뿐이다 -- 이미 해본 걸 또 권하면 코치가 대화를 안 듣고
있다는 인상을 준다.
"""

from __future__ import annotations

from acting_api.db.store import pending_takes_from_report


def test_an_analysis_card_yields_its_next_direction():
    report = {
        "report_type": "analysis",
        "next_take": {"direction": "한 박자 늦게 말해보기", "tested": False},
    }

    assert pending_takes_from_report(report) == ("한 박자 늦게 말해보기",)


def test_an_expression_card_yields_untested_training_only():
    report = {
        "report_type": "expression",
        "effective_experiments": [{"instruction": "숨을 먼저 뱉기", "tested": True}],
        "actor_training": [
            {"title": "호흡 늘리기", "tested": False},
            {"title": "이미 해본 것", "tested": True},
        ],
    }

    assert pending_takes_from_report(report) == ("호흡 늘리기",)


def test_what_was_already_tried_is_never_returned():
    """해본 것을 다시 권하면 대화를 안 듣고 있다는 인상을 준다."""
    report = {
        "report_type": "analysis",
        "next_take": {"direction": "해본 방향", "tested": True},
    }

    assert pending_takes_from_report(report) == ()


def test_a_blocked_card_yields_nothing():
    assert pending_takes_from_report({"report_type": "blocked"}) == ()


def test_missing_or_malformed_input_yields_nothing_instead_of_raising():
    """카드 모양이 달라져도 대화 시작이 실패하면 안 된다."""
    for value in (None, {}, [], "문자열", {"report_type": "analysis"}):
        assert pending_takes_from_report(value) == ()


def test_blank_directions_are_dropped():
    report = {"report_type": "analysis", "next_take": {"direction": "   ", "tested": False}}

    assert pending_takes_from_report(report) == ()
