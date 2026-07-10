from acting_report.prompt import build_prompt
from support import PREV_RECORD, SESSION


def test_prompt_contains_target_and_turns():
    p = build_prompt(SESSION, [])
    assert "1.2초 멈춤" in p  # 타깃 anomaly (첫 번째 = high)
    assert "시선 이탈" not in p  # 두 번째 anomaly는 리포트에 안 들어감
    assert "대사가 기억 안 났어요" in p  # 대화 원문
    assert "gap_stated" in p  # 종료 사유


def test_prompt_no_previous():
    p = build_prompt(SESSION, [])
    assert "이전 리포트 없음" in p


def test_prompt_with_previous():
    p = build_prompt(SESSION, [PREV_RECORD])
    assert "상대를 안 보고 바닥을 봤어" in p
    assert "2026-07-01" in p
