import hashlib
import logging
import time
from pathlib import Path

from google.genai import types

from acting_summary.prompt import OBSERVATION_SYSTEM_PROMPT, buildObservationPrompt
from acting_summary.schema import ActorMaterial, ObservationPack


logger = logging.getLogger(__name__)


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


def _cache_path(cache_dir, video_path, prompt: str, model: str) -> Path:
    h = hashlib.sha256()
    h.update(Path(video_path).read_bytes())
    h.update(OBSERVATION_SYSTEM_PROMPT.encode("utf-8"))
    h.update(prompt.encode("utf-8"))
    h.update(model.encode("utf-8"))
    return Path(cache_dir) / f"{h.hexdigest()}.json"


def _parse(response) -> ObservationPack:
    parsed = getattr(response, "parsed", None)
    if isinstance(parsed, ObservationPack):
        return parsed
    text = getattr(response, "text", None)
    if text:
        try:
            return ObservationPack.model_validate_json(text)
        except Exception as exc:  # noqa: BLE001
            raise SummaryParseError(str(exc)) from exc
    raise SummaryParseError("no parseable observation pack in response")


def _log_generation(model: str, elapsed: float, attempts: int, response) -> None:
    """관찰 팩 한 건의 Gemini 구간을 한 줄로 남긴다.

    분석이 느릴 때 원인을 가르려면 이 줄이 있어야 한다 — 소요 시간·thinking 토큰·재시도
    여부는 응답에만 있고 DB(`summaries.raw` 는 파싱된 관찰만 저장)에도 Sentry
    (`traces_sample_rate=0.0`)에도 남지 않는다. 2026-08-10 에 같은 영상·같은 모델의 분석이
    29.2초와 351.5초로 갈렸을 때, 느린 쪽이 thinking 폭주인지 파싱 재시도인지 단일 호출
    롱테일인지 사후에 가릴 수 없었다.
    """
    usage = getattr(response, "usage_metadata", None)
    logger.info(
        "summary generated model=%s elapsed=%.1fs attempts=%d "
        "prompt_tokens=%s output_tokens=%s thinking_tokens=%s",
        model,
        elapsed,
        attempts,
        getattr(usage, "prompt_token_count", None),
        getattr(usage, "candidates_token_count", None),
        getattr(usage, "thoughts_token_count", None),
    )


def _filter_observations(pack: ObservationPack, duration_ms: int) -> ObservationPack:
    observations = [
        item
        for item in pack.observations
        if item.start_ms >= 0
        and item.end_ms > item.start_ms
        and item.end_ms <= duration_ms
    ][:3]
    return pack.model_copy(update={"observations": observations})


def summarize(
    video_path,
    actor: ActorMaterial,
    *,
    client,
    model: str,
    # 압축 폴백으로 수백 MB 원본이 올라오면 Files API 처리(ACTIVE 전환)가 오래 걸린다
    active_timeout: float = 300.0,
    # ACTIVE 전환은 보통 1~2초에 끝난다. 2초 간격이면 그 대기의 절반이 폴링 지연이라
    # 0.4초로 줄인다 — 요청은 상태 조회 한 번이라 비용이 거의 없다.
    poll_interval: float = 0.4,
    cache_dir=None,
) -> ObservationPack:
    prompt = buildObservationPrompt(actor)
    cache_path = None
    if cache_dir is not None:
        cache_path = _cache_path(cache_dir, video_path, prompt, model)
        if cache_path.exists():
            return _filter_observations(
                ObservationPack.model_validate_json(
                    cache_path.read_text(encoding="utf-8")
                ),
                actor.duration_ms,
            )
    uploaded = client.files.upload(file=str(video_path))
    try:
        uploaded = _wait_active(client, uploaded, active_timeout, poll_interval)
        config = types.GenerateContentConfig(
            system_instruction=OBSERVATION_SYSTEM_PROMPT,
            response_mime_type="application/json",
            response_schema=ObservationPack,
            temperature=0.0,
            top_p=0.1,
            top_k=1,
            seed=42,
            # 영상 토큰을 초당 ~300→~100(66%↓)으로. Gemini 토큰은 영상 길이 기반이라
            # 파일 크기가 아닌 이 설정이 실제 비용을 줄인다. 프레임당 258→64토큰.
            media_resolution=types.MediaResolution.MEDIA_RESOLUTION_LOW,
        )
        last_err = None
        started = time.monotonic()
        for attempt in range(1, 3):
            response = client.models.generate_content(
                model=model, contents=[uploaded, prompt], config=config
            )
            try:
                result = _filter_observations(_parse(response), actor.duration_ms)
            except SummaryParseError as exc:
                last_err = exc
                continue
            _log_generation(model, time.monotonic() - started, attempt, response)
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
