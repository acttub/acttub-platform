import logging

import pytest
from google.genai import types

from acting_summary.prompt import OBSERVATION_SYSTEM_PROMPT
from acting_summary.schema import ActorMaterial, ObservationPack
from acting_summary.summarizer import FileActiveTimeout, SummaryParseError, summarize

ACTOR = ActorMaterial(
    situation="a",
    character="b",
    goal="c",
    blockage_kind="분석",
    blockage_detail="d",
    duration_ms=1000,
)
PACK = ObservationPack(
    observations=[
        {"start_ms": 10, "end_ms": 20, "label": "대사가 시작된다", "confidence": 0.9}
    ],
    uncertainties=["얼굴은 확인되지 않음"],
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


def test_zero_observations_is_a_normal_result_and_file_is_deleted():
    empty = ObservationPack(observations=[], uncertainties=["사람이 보이지 않음"])
    client = FakeClient([_Resp(parsed=empty)])

    result = summarize("v.mp4", ACTOR, client=client, model="m")

    assert result.observations == []
    assert client.files.deleted == ["files/abc"]


def test_more_than_three_observations_are_truncated_to_three():
    pack = ObservationPack(
        observations=[
            {"start_ms": i * 10, "end_ms": i * 10 + 5, "label": str(i), "confidence": 1}
            for i in range(4)
        ],
        uncertainties=[],
    )

    result = summarize("v.mp4", ACTOR, client=FakeClient([_Resp(parsed=pack)]), model="m")

    assert [item.label for item in result.observations] == ["0", "1", "2"]


def test_observation_past_video_duration_is_discarded():
    pack = ObservationPack(
        observations=[
            {"start_ms": 0, "end_ms": 1000, "label": "유효", "confidence": 1},
            {"start_ms": 900, "end_ms": 1001, "label": "초과", "confidence": 1},
        ],
        uncertainties=[],
    )

    result = summarize("v.mp4", ACTOR, client=FakeClient([_Resp(parsed=pack)]), model="m")

    assert [item.label for item in result.observations] == ["유효"]


def test_invalid_time_ranges_are_discarded():
    pack = ObservationPack(
        observations=[
            {"start_ms": -1, "end_ms": 10, "label": "음수", "confidence": 1},
            {"start_ms": 10, "end_ms": 10, "label": "빈 구간", "confidence": 1},
        ],
        uncertainties=[],
    )

    result = summarize("v.mp4", ACTOR, client=FakeClient([_Resp(parsed=pack)]), model="m")

    assert result.observations == []


def test_sdk_generation_settings_are_preserved():
    client = FakeClient([_Resp(parsed=PACK)])

    summarize("v.mp4", ACTOR, client=client, model="m")

    config = client.models.calls[0][2]
    assert config.system_instruction == OBSERVATION_SYSTEM_PROMPT
    assert config.response_schema is ObservationPack
    assert config.temperature == 0.0
    assert config.seed == 42
    assert config.media_resolution == types.MediaResolution.MEDIA_RESOLUTION_LOW


def test_text_response_is_parsed_and_bad_response_retries_once():
    parsed = summarize(
        "v.mp4",
        ACTOR,
        client=FakeClient([_Resp(text=PACK.model_dump_json())]),
        model="m",
    )
    assert parsed == PACK

    client = FakeClient([_Resp(text="bad"), _Resp(text="still bad")])
    with pytest.raises(SummaryParseError):
        summarize("v.mp4", ACTOR, client=client, model="m")
    assert len(client.models.calls) == 2


class _Usage:
    def __init__(self, prompt, output, thinking):
        self.prompt_token_count = prompt
        self.candidates_token_count = output
        self.thoughts_token_count = thinking


def _log_lines(caplog):
    return [
        record.getMessage()
        for record in caplog.records
        if record.name == "acting_summary.summarizer"
    ]


def test_generation_is_logged_with_timing_and_token_counts(caplog):
    response = _Resp(parsed=PACK)
    response.usage_metadata = _Usage(10846, 315, 4284)

    with caplog.at_level(logging.INFO, logger="acting_summary.summarizer"):
        summarize("v.mp4", ACTOR, client=FakeClient([response]), model="m")

    lines = _log_lines(caplog)
    assert len(lines) == 1
    assert "model=m" in lines[0]
    assert "attempts=1" in lines[0]
    assert "prompt_tokens=10846" in lines[0]
    assert "output_tokens=315" in lines[0]
    assert "thinking_tokens=4284" in lines[0]
    assert "elapsed=" in lines[0]


def test_parse_retry_is_visible_in_the_log(caplog):
    client = FakeClient([_Resp(text="bad"), _Resp(parsed=PACK)])

    with caplog.at_level(logging.INFO, logger="acting_summary.summarizer"):
        summarize("v.mp4", ACTOR, client=client, model="m")

    assert len(client.models.calls) == 2
    assert "attempts=2" in _log_lines(caplog)[0]


def test_missing_usage_metadata_does_not_break_logging(caplog):
    with caplog.at_level(logging.INFO, logger="acting_summary.summarizer"):
        summarize("v.mp4", ACTOR, client=FakeClient([_Resp(parsed=PACK)]), model="m")

    assert "thinking_tokens=None" in _log_lines(caplog)[0]


def test_cache_hit_skips_upload_and_generation(tmp_path):
    video = tmp_path / "v.mp4"
    video.write_bytes(b"video")
    cache = tmp_path / "cache"
    first = FakeClient([_Resp(parsed=PACK)])
    summarize(video, ACTOR, client=first, model="m", cache_dir=cache)
    second = FakeClient([])

    result = summarize(video, ACTOR, client=second, model="m", cache_dir=cache)

    assert result == PACK
    assert second.models.calls == []
    assert second.files.deleted == []


def test_processing_timeout_raises():
    client = FakeClient([_Resp(parsed=PACK)], state="PROCESSING")
    with pytest.raises(FileActiveTimeout):
        summarize("v.mp4", ACTOR, client=client, model="m", active_timeout=0)


@pytest.mark.parametrize(
    ("start_ms", "end_ms", "kept"),
    [
        (0, 1, True),
        (999, 1000, True),
        (-1, 1, False),
        (10, 10, False),
        (999, 1001, False),
    ],
)
def test_observation_time_filter_boundaries(start_ms, end_ms, kept):
    pack = ObservationPack(
        observations=[
            {
                "start_ms": start_ms,
                "end_ms": end_ms,
                "label": "경계 관찰",
                "confidence": 0.5,
            }
        ],
        uncertainties=[],
    )
    result = summarize(
        "v.mp4", ACTOR, client=FakeClient([_Resp(parsed=pack)]), model="m"
    )
    assert bool(result.observations) is kept
