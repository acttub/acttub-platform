import pytest

from acting_summary.schema import Anomaly, Observation, SceneSummary, SubText
from acting_summary.summarizer import (
    FileActiveTimeout,
    SummaryParseError,
    summarize,
)

SUBTEXT = SubText(situation="a", character="b", subtext="c")
SUMMARY = SceneSummary(
    observation=Observation(
        timeline="t",
        dialogue="d",
        tempo="te",
        pitch="p",
        movement="m",
        expression="e",
        emotion="em",
    ),
    summary="s",
    intent_alignment="i",
    key_moment="km",
    key_dimension="kd",
    anomalies=[
        Anomaly(
            start="00:01",
            end="00:02",
            dimension="대사",
            what="w",
            why_odd="o",
            likely_cause="c",
            impact_on_intent="ii",
            overlaps_key_moment=True,
            on_key_dimension=True,
            intent_impact="반전",
            severity="high",
            severity_reason="sr",
        )
    ],
)


def _mk_anomaly(start="00:00", dimension="대사", okm=False, okd=False, impact="국소"):
    return Anomaly(
        start=start,
        end="00:10",
        dimension=dimension,
        what="w",
        why_odd="o",
        likely_cause="c",
        impact_on_intent="ii",
        overlaps_key_moment=okm,
        on_key_dimension=okd,
        intent_impact=impact,
        severity="low",  # 모델이 뭐라고 찍든 후처리가 재계산해야 함
        severity_reason="sr",
    )


def _mk_summary(anomalies):
    return SceneSummary(
        observation=SUMMARY.observation,
        summary="s",
        intent_alignment="i",
        key_moment="km",
        key_dimension="kd",
        anomalies=anomalies,
    )


class _State:
    def __init__(self, name):
        self.name = name


class _File:
    def __init__(self, name, state):
        self.name = name
        self.state = _State(state)


class _Resp:
    def __init__(self, parsed=None, text=None):
        self.parsed = parsed
        self.text = text


class _Files:
    def __init__(self, state="ACTIVE"):
        self._state = state
        self.deleted = []

    def upload(self, file):
        return _File("files/abc", self._state)

    def get(self, name):
        return _File(name, self._state)

    def delete(self, name):
        self.deleted.append(name)


class _Models:
    def __init__(self, responses):
        self._responses = list(responses)
        self.calls = []

    def generate_content(self, model, contents, config):
        self.calls.append((model, contents, config))
        return self._responses.pop(0)


class FakeClient:
    def __init__(self, responses, state="ACTIVE"):
        self.files = _Files(state)
        self.models = _Models(responses)


def test_summarize_returns_parsed_and_deletes_file():
    client = FakeClient([_Resp(parsed=SUMMARY)])
    out = summarize("v.mp4", SUBTEXT, client=client, model="m")
    assert out is SUMMARY
    assert client.files.deleted == ["files/abc"]
    assert client.models.calls[0][0] == "m"


def test_summarize_parses_text_when_no_parsed():
    client = FakeClient([_Resp(parsed=None, text=SUMMARY.model_dump_json())])
    out = summarize("v.mp4", SUBTEXT, client=client, model="m")
    assert out.summary == "s"


def test_summarize_retries_once_then_raises():
    client = FakeClient(
        [_Resp(parsed=None, text="not json"), _Resp(parsed=None, text="still bad")]
    )
    with pytest.raises(SummaryParseError):
        summarize("v.mp4", SUBTEXT, client=client, model="m")
    assert len(client.models.calls) == 2  # 1회 재시도
    assert client.files.deleted == ["files/abc"]  # 실패해도 정리


def test_summarize_config_is_deterministic():
    client = FakeClient([_Resp(parsed=SUMMARY)])
    summarize("v.mp4", SUBTEXT, client=client, model="m")
    config = client.models.calls[0][2]
    assert config.temperature == 0.0
    assert config.seed == 42
    assert config.top_p == 0.1
    assert config.top_k == 1


def test_summarize_cache_hit_skips_api(tmp_path):
    video = tmp_path / "v.mp4"
    video.write_bytes(b"fake video bytes")
    cache_dir = tmp_path / "cache"

    client1 = FakeClient([_Resp(parsed=SUMMARY)])
    out1 = summarize(video, SUBTEXT, client=client1, model="m", cache_dir=cache_dir)
    assert len(client1.models.calls) == 1

    client2 = FakeClient([_Resp(parsed=SUMMARY)])
    out2 = summarize(video, SUBTEXT, client=client2, model="m", cache_dir=cache_dir)
    assert len(client2.models.calls) == 0  # 캐시 히트 → API 호출 없음
    assert client2.files.deleted == []  # 업로드 자체를 안 함
    assert out2 == out1


def test_summarize_cache_miss_on_different_subtext(tmp_path):
    video = tmp_path / "v.mp4"
    video.write_bytes(b"fake video bytes")
    cache_dir = tmp_path / "cache"

    client1 = FakeClient([_Resp(parsed=SUMMARY)])
    summarize(video, SUBTEXT, client=client1, model="m", cache_dir=cache_dir)

    other = SubText(situation="a", character="b", subtext="다른 의도")
    client2 = FakeClient([_Resp(parsed=SUMMARY)])
    summarize(video, other, client=client2, model="m", cache_dir=cache_dir)
    assert len(client2.models.calls) == 1  # 서브텍스트 다르면 새로 호출


def test_summarize_without_cache_dir_never_writes(tmp_path):
    video = tmp_path / "v.mp4"
    video.write_bytes(b"fake video bytes")
    client = FakeClient([_Resp(parsed=SUMMARY)])
    summarize(video, SUBTEXT, client=client, model="m")
    assert not (tmp_path / "cache").exists()


def test_summarize_timeout_when_not_active():
    client = FakeClient([_Resp(parsed=SUMMARY)], state="PROCESSING")
    with pytest.raises(FileActiveTimeout):
        summarize("v.mp4", SUBTEXT, client=client, model="m", active_timeout=0)


def test_summarize_recomputes_severity_from_facts():
    # 모델이 severity를 전부 low로 찍어도 사실 판단 기반으로 재계산된다
    raw = _mk_summary(
        [
            _mk_anomaly(okm=True, okd=True, impact="반전"),  # 4점 → high
            _mk_anomaly(okm=True, okd=False, impact="약화"),  # 2점 → mid
            _mk_anomaly(
                okm=False, okd=False, impact="반전"
            ),  # 2점 → mid (key 무관은 high 불가)
            _mk_anomaly(okm=False, okd=False, impact="국소"),  # 0점 → low
        ]
    )
    client = FakeClient([_Resp(parsed=raw)])
    out = summarize("v.mp4", SUBTEXT, client=client, model="m")
    assert [a.severity for a in out.anomalies] == ["high", "mid", "mid", "low"]


def test_summarize_sorts_anomalies_deterministically():
    a_low = _mk_anomaly(start="00:00", impact="국소")  # low
    a_high = _mk_anomaly(start="00:30", okm=True, okd=True, impact="반전")  # high
    a_mid_key = _mk_anomaly(start="00:20", okm=True, impact="약화")  # mid, key 1개
    a_mid_late = _mk_anomaly(start="00:25", impact="반전")  # mid, key 0개
    a_mid_early = _mk_anomaly(
        start="00:05", impact="반전"
    )  # mid, key 0개, 더 이른 시작
    a_mid_axis = _mk_anomaly(
        start="00:05", dimension="템포", impact="반전"
    )  # 같은 시작, 뒷축
    raw = _mk_summary([a_low, a_mid_axis, a_mid_late, a_high, a_mid_early, a_mid_key])
    client = FakeClient([_Resp(parsed=raw)])
    out = summarize("v.mp4", SUBTEXT, client=client, model="m")
    starts = [(a.severity, a.start, a.dimension) for a in out.anomalies]
    assert starts == [
        ("high", "00:30", "대사"),  # 등급 우선
        ("mid", "00:20", "대사"),  # 같은 등급이면 key 점수 높은 것 먼저
        ("mid", "00:05", "대사"),  # 그다음 start 빠른 순
        ("mid", "00:05", "템포"),  # 같은 start면 축 고정 순서
        ("mid", "00:25", "대사"),
        ("low", "00:00", "대사"),
    ]
