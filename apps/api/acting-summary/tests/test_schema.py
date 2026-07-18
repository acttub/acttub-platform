import pytest
from pydantic import ValidationError

from acting_summary.schema import Anomaly, Observation, SceneSummary, SubText


def _obs_data():
    return {
        "timeline": "00:00 등장 ... 00:30 퇴장",
        "dialogue": "대사 내용·딕션",
        "tempo": "속도·리듬·사이",
        "pitch": "피치·억양·강세",
        "movement": "제스처·블로킹·자세",
        "expression": "표정·시선",
        "emotion": "감정선·진정성",
        "extra": [{"name": "호흡", "observation": "숨이 얕음"}],
    }


def test_subtext_fields():
    s = SubText(situation="카페", character="소심한 신입", subtext="사실은 화남")
    assert s.situation == "카페"
    assert s.character == "소심한 신입"
    assert s.subtext == "사실은 화남"


def _anomaly_data():
    return {
        "start": "00:12",
        "end": "00:15",
        "dimension": "높낮이",
        "what": "갑자기 웃음",
        "why_odd": "서브텍스트와 충돌",
        "likely_cause": "긴장 해소용 습관",
        "impact_on_intent": "화난 의도가 흐려짐",
        "overlaps_key_moment": True,
        "on_key_dimension": False,
        "intent_impact": "반전",
        "severity": "high",
        "severity_reason": "핵심 구간(00:10~00:15) 한가운데의 이탈",
    }


def test_scene_summary_roundtrip():
    data = {
        "observation": _obs_data(),
        "summary": "압축 요약",
        "intent_alignment": "의도 대비 정렬",
        "key_moment": "00:10~00:15 — 서브텍스트가 드러나는 정점",
        "key_dimension": "감정 — 억눌린 분노가 씬의 축",
        "anomalies": [_anomaly_data()],
    }
    s = SceneSummary.model_validate(data)
    assert isinstance(s.observation, Observation)
    assert s.observation.tempo == "속도·리듬·사이"
    assert s.observation.extra[0].name == "호흡"
    assert isinstance(s.anomalies[0], Anomaly)
    assert s.anomalies[0].dimension == "높낮이"
    assert s.anomalies[0].likely_cause == "긴장 해소용 습관"
    assert s.anomalies[0].impact_on_intent == "화난 의도가 흐려짐"
    assert s.anomalies[0].severity == "high"
    assert s.anomalies[0].start == "00:12"
    assert s.anomalies[0].end == "00:15"
    assert "00:10~00:15" in s.key_moment
    assert "핵심 구간" in s.anomalies[0].severity_reason
    assert s.model_dump() == data


def test_observation_extra_defaults_empty():
    data = _obs_data()
    data.pop("extra")
    obs = Observation.model_validate(data)
    assert obs.extra == []


def test_scene_summary_missing_field_raises():
    with pytest.raises(ValidationError):
        SceneSummary.model_validate({"summary": "x"})


def test_anomaly_missing_new_field_raises():
    with pytest.raises(ValidationError):
        Anomaly.model_validate(
            {"start": "00:01", "dimension": "대사", "what": "w", "why_odd": "o"}
        )


def test_anomaly_end_required():
    data = _anomaly_data()
    data.pop("end")
    with pytest.raises(ValidationError):
        Anomaly.model_validate(data)


def test_anomaly_severity_literal():
    ok = Anomaly.model_validate({**_anomaly_data(), "severity": "mid"})
    assert ok.severity == "mid"
    with pytest.raises(ValidationError):
        Anomaly.model_validate({**_anomaly_data(), "severity": "critical"})


def test_anomaly_intent_impact_literal():
    ok = Anomaly.model_validate({**_anomaly_data(), "intent_impact": "약화"})
    assert ok.intent_impact == "약화"
    with pytest.raises(ValidationError):
        Anomaly.model_validate({**_anomaly_data(), "intent_impact": "심각"})


def test_anomaly_fact_fields_required():
    for field in ["overlaps_key_moment", "on_key_dimension", "intent_impact"]:
        data = _anomaly_data()
        data.pop(field)
        with pytest.raises(ValidationError):
            Anomaly.model_validate(data)


def test_anomaly_severity_required():
    data = _anomaly_data()
    data.pop("severity")
    with pytest.raises(ValidationError):
        Anomaly.model_validate(data)


def test_scene_summary_key_fields_required():
    data = {
        "observation": _obs_data(),
        "summary": "요약",
        "intent_alignment": "정렬",
        "anomalies": [],
    }
    with pytest.raises(ValidationError):
        SceneSummary.model_validate(data)
