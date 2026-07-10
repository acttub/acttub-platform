import hashlib
import time
from pathlib import Path

from google.genai import types

from acting_summary.prompt import build
from acting_summary.schema import SceneSummary, SubText


class FileActiveTimeout(Exception):
    pass


class SummaryParseError(Exception):
    pass


def _wait_active(client, file, timeout, poll_interval):
    deadline = time.monotonic() + timeout
    current = file
    while current.state.name == "PROCESSING":
        if time.monotonic() >= deadline:
            raise FileActiveTimeout(f"file {current.name} not ACTIVE within {timeout}s")
        time.sleep(poll_interval)
        current = client.files.get(name=current.name)
    if current.state.name != "ACTIVE":
        raise FileActiveTimeout(f"file {current.name} state={current.state.name}")
    return current


_AXIS_ORDER = ["대사", "템포", "높낮이", "움직임", "표정", "감정"]
_IMPACT_POINTS = {"반전": 2, "약화": 1, "국소": 0}
_SEVERITY_RANK = {"high": 0, "mid": 1, "low": 2}


def _key_score(anomaly) -> int:
    return int(anomaly.overlaps_key_moment) + int(anomaly.on_key_dimension)


def _severity(anomaly) -> str:
    score = _key_score(anomaly) + _IMPACT_POINTS[anomaly.intent_impact]
    if score >= 3:
        return "high"
    if score >= 1:
        return "mid"
    return "low"


def _start_seconds(start: str) -> int:
    try:
        minutes, seconds = start.split(":")
        return int(minutes) * 60 + int(seconds)
    except ValueError:
        return 10**9


def _axis_index(dimension: str) -> int:
    first = dimension.split(",")[0].strip()
    try:
        return _AXIS_ORDER.index(first)
    except ValueError:
        return len(_AXIS_ORDER)


def _finalize(summary: SceneSummary) -> SceneSummary:
    for anomaly in summary.anomalies:
        anomaly.severity = _severity(anomaly)
    summary.anomalies.sort(
        key=lambda a: (
            _SEVERITY_RANK[a.severity],
            -_key_score(a),
            _start_seconds(a.start),
            _axis_index(a.dimension),
        )
    )
    return summary


def _cache_path(cache_dir, video_path, prompt: str, model: str) -> Path:
    h = hashlib.sha256()
    h.update(Path(video_path).read_bytes())
    h.update(prompt.encode("utf-8"))
    h.update(model.encode("utf-8"))
    return Path(cache_dir) / f"{h.hexdigest()}.json"


def _parse(response) -> SceneSummary:
    parsed = getattr(response, "parsed", None)
    if isinstance(parsed, SceneSummary):
        return parsed
    text = getattr(response, "text", None)
    if text:
        try:
            return SceneSummary.model_validate_json(text)
        except Exception as exc:  # noqa: BLE001
            raise SummaryParseError(str(exc)) from exc
    raise SummaryParseError("no parseable summary in response")


def summarize(
    video_path,
    subtext: SubText,
    *,
    client,
    model: str,
    active_timeout: float = 120.0,
    poll_interval: float = 2.0,
    cache_dir=None,
) -> SceneSummary:
    prompt = build(subtext)
    cache_path = None
    if cache_dir is not None:
        cache_path = _cache_path(cache_dir, video_path, prompt, model)
        if cache_path.exists():
            return SceneSummary.model_validate_json(
                cache_path.read_text(encoding="utf-8")
            )
    uploaded = client.files.upload(file=str(video_path))
    try:
        uploaded = _wait_active(client, uploaded, active_timeout, poll_interval)
        config = types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=SceneSummary,
            temperature=0.0,
            top_p=0.1,
            top_k=1,
            seed=42,
        )
        last_err = None
        for _ in range(2):
            response = client.models.generate_content(
                model=model, contents=[uploaded, prompt], config=config
            )
            try:
                result = _parse(response)
            except SummaryParseError as exc:
                last_err = exc
                continue
            result = _finalize(result)
            if cache_path is not None:
                cache_path.parent.mkdir(parents=True, exist_ok=True)
                cache_path.write_text(result.model_dump_json(), encoding="utf-8")
            return result
        raise SummaryParseError(f"failed to parse after retry: {last_err}")
    finally:
        try:
            client.files.delete(name=uploaded.name)
        except Exception:  # noqa: BLE001
            pass
