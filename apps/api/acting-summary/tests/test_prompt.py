from acting_summary.prompt import build
from acting_summary.schema import SubText


def test_build_injects_subtext_fields():
    s = SubText(situation="면접장", character="긴장한 지원자", subtext="합격에 필사적")
    text = build(s)
    assert "면접장" in text
    assert "긴장한 지원자" in text
    assert "합격에 필사적" in text


def test_build_contains_rules():
    s = SubText(situation="a", character="b", subtext="c")
    text = build(s)
    # 핵심 키워드가 들어가는지
    assert "observation" in text
    assert "summary" in text
    assert "anomalies" in text
    assert "생략" in text  # 생략 규칙
    assert "판정" in text or "점수" in text  # 판정 금지 규칙


def test_build_contains_six_dimensions():
    s = SubText(situation="a", character="b", subtext="c")
    text = build(s)
    for axis in ["대사", "템포", "높낮이", "움직임", "표정", "감정"]:
        assert axis in text


def test_build_contains_three_layer_why():
    s = SubText(situation="a", character="b", subtext="c")
    text = build(s)
    assert "why_odd" in text
    assert "likely_cause" in text
    assert "impact_on_intent" in text


def test_build_contains_fixed_grid_scan_rule():
    s = SubText(situation="a", character="b", subtext="c")
    text = build(s)
    assert "5초" in text
    assert "00:00~00:05" in text  # 고정 그리드 예시
    assert "segment_scan" not in text  # 점검 기록은 출력하지 않음


def test_build_contains_time_range_rule():
    s = SubText(situation="a", character="b", subtext="c")
    text = build(s)
    assert "start" in text
    assert "end" in text
    assert "구간" in text
    # 지속·반복 이상은 하나로 묶어 전체 구간으로
    assert "반복" in text
    assert "최초 등장" in text
    assert "마지막 등장" in text
    # 구간 최소 길이 8~10초
    assert "최소 8초" in text
    assert "8~10초" in text


def test_build_contains_quantified_observation_rule():
    s = SubText(situation="a", character="b", subtext="c")
    text = build(s)
    assert "수치화" in text
    assert "45도" in text  # 좋은 예시가 프롬프트에 포함


def test_build_contains_priority_rules():
    s = SubText(situation="a", character="b", subtext="c")
    text = build(s)
    assert "key_moment" in text
    assert "key_dimension" in text
    assert "severity" in text
    assert "severity_reason" in text
    assert "중요도순" in text  # 정렬 규칙
    assert "훼손" in text  # severity 기준


def test_build_contains_determinism_directive():
    s = SubText(situation="a", character="b", subtext="c")
    text = build(s)
    # 같은 입력 → 같은 출력 지시
    assert "같은 출력" in text
    # 임의 변형 금지
    assert "유의어" in text


def test_build_contains_fixed_notation_rules():
    s = SubText(situation="a", character="b", subtext="c")
    text = build(s)
    assert "MM:SS" in text  # 시간 표기 고정
    assert "5도 단위" in text  # 각도 반올림 단위
    assert "경계" in text  # 그리드 경계 스냅


def test_build_contains_fixed_procedure_order():
    s = SubText(situation="a", character="b", subtext="c")
    text = build(s)
    assert "절차" in text
    # 축 점검 순서 고정
    assert "대사→템포→높낮이→움직임→표정→감정" in text


def test_build_contains_severity_rubric():
    s = SubText(situation="a", character="b", subtext="c")
    text = build(s)
    # 등급별 조건이 명시적으로 존재
    assert "high:" in text
    assert "mid:" in text
    assert "low:" in text


def test_build_contains_severity_score_table():
    s = SubText(situation="a", character="b", subtext="c")
    text = build(s)
    # severity는 감각이 아니라 사실 판단 3개 + 점수 합산
    assert "overlaps_key_moment" in text
    assert "on_key_dimension" in text
    assert "intent_impact" in text
    assert "반전" in text
    assert "약화" in text
    assert "국소" in text
    assert "3점 이상" in text


def test_build_contains_minimum_anomaly_count():
    s = SubText(situation="a", character="b", subtext="c")
    text = build(s)
    assert "최소 4개" in text
    assert "지어내지 않는다" in text  # 날조 금지


def test_build_contains_total_order_sort():
    s = SubText(situation="a", character="b", subtext="c")
    text = build(s)
    # 동률 없는 전순서 정렬 (마지막 tie-break까지)
    assert "start가 빠른" in text
