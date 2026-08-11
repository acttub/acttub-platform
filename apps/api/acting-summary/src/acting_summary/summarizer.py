import hashlib
import logging
import time
from pathlib import Path

import httpx
from google.genai import errors
from google.genai import types

from acting_summary.prompt import OBSERVATION_SYSTEM_PROMPT, buildObservationPrompt
from acting_summary.schema import ActorMaterial, ObservationPack


logger = logging.getLogger(__name__)

# 정상 실측 15.6/29.2/39.2/61.4/73.0/74.5초는 살리되 250.3/351.5초 폭주는
# 끊도록, 요청자가 정한 목표 60초·데드라인 75초를 적용한다.
SUMMARY_DEADLINE_SECONDS = 75.0
# MINIMAL 재호출도 무한 대기하지 않도록 별도의 새 75초 데드라인을 쓴다.
MINIMAL_FALLBACK_TIMEOUT_SECONDS = 75.0


class FileActiveTimeout(Exception):
    pass


class SummaryParseError(Exception):
    pass


class SummaryDeadlineTimeout(TimeoutError):
    pass


def _remaining_seconds(deadline: float) -> float:
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise SummaryDeadlineTimeout("summary deadline exceeded")
    return remaining


def _http_options(timeout: float) -> types.HttpOptions:
    # SDK 타입의 단위는 밀리초다. 버림해 전체 데드라인을 1ms라도 넘기지 않는다.
    timeout_ms = int(timeout * 1000)
    if timeout_ms <= 0:
        raise SummaryDeadlineTimeout("summary deadline exceeded")
    return types.HttpOptions(timeout=timeout_ms)


def _wait_active(client, file, timeout, poll_interval, *, overall_deadline=None):
    deadline = time.monotonic() + timeout
    if overall_deadline is not None:
        deadline = min(deadline, overall_deadline)
    current = file
    while current.state.name == "PROCESSING":
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise FileActiveTimeout(f"file {current.name} not ACTIVE within {timeout}s")
        time.sleep(min(poll_interval, remaining))
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise FileActiveTimeout(f"file {current.name} not ACTIVE within {timeout}s")
        try:
            current = client.files.get(
                name=current.name,
                config=types.GetFileConfig(http_options=_http_options(remaining)),
            )
        except Exception as exc:  # noqa: BLE001
            if _is_deadline_timeout(exc):
                raise FileActiveTimeout(
                    f"file {current.name} not ACTIVE within {timeout}s"
                ) from exc
            raise
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


def _log_generation(
    model: str, elapsed: float, attempts: int, path: str, response
) -> None:
    """관찰 팩 한 건의 Gemini 구간을 한 줄로 남긴다.

    분석이 느릴 때 원인을 가르려면 이 줄이 있어야 한다 — 소요 시간·thinking 토큰·재시도
    여부는 응답에만 있고 DB(`summaries.raw` 는 파싱된 관찰만 저장)에도 Sentry
    (`traces_sample_rate=0.0`)에도 남지 않는다. 2026-08-10 에 같은 영상·같은 모델의 분석이
    29.2초와 351.5초로 갈렸을 때, 느린 쪽이 thinking 폭주인지 파싱 재시도인지 단일 호출
    롱테일인지 사후에 가릴 수 없었다.
    """
    usage = getattr(response, "usage_metadata", None)
    logger.info(
        "summary generated model=%s elapsed=%.1fs attempts=%d path=%s "
        "prompt_tokens=%s output_tokens=%s thinking_tokens=%s",
        model,
        elapsed,
        attempts,
        path,
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


def _generation_config(
    thinking_level: types.ThinkingLevel, timeout: float
) -> types.GenerateContentConfig:
    return types.GenerateContentConfig(
        http_options=_http_options(timeout),
        system_instruction=OBSERVATION_SYSTEM_PROMPT,
        response_mime_type="application/json",
        response_schema=ObservationPack,
        temperature=0.0,
        top_p=0.1,
        top_k=1,
        seed=42,
        # 이 모델의 기본 등급은 HIGH 이고, 2026-08-10 운영에서 같은 영상·같은 입력인데
        # 생각만 6.3만 토큰까지 간 실행이 두 번 나왔다(정상은 4.6천). 사고를 없애지는
        # 않되 폭주를 억제해 목표 60초를 맞추도록 평소 등급은 LOW로 고정한다.
        thinking_config=types.ThinkingConfig(thinking_level=thinking_level),
        # 영상 토큰을 초당 ~300→~100(66%↓)으로. Gemini 토큰은 영상 길이 기반이라
        # 파일 크기가 아닌 이 설정이 실제 비용을 줄인다. 프레임당 258→64토큰.
        media_resolution=types.MediaResolution.MEDIA_RESOLUTION_LOW,
    )


def _is_deadline_timeout(exc: Exception) -> bool:
    return isinstance(exc, (TimeoutError, httpx.TimeoutException)) or (
        isinstance(exc, errors.APIError) and exc.code in {408, 504}
    )


def summarize(
    video_path,
    actor: ActorMaterial,
    *,
    client,
    model: str,
    # ACTIVE 대기도 업로드·생성과 같은 75초 전체 예산 안에서만 허용한다.
    active_timeout: float = SUMMARY_DEADLINE_SECONDS,
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
    primary_deadline = time.monotonic() + SUMMARY_DEADLINE_SECONDS
    try:
        uploaded = client.files.upload(
            file=str(video_path),
            config=types.UploadFileConfig(
                http_options=_http_options(_remaining_seconds(primary_deadline))
            ),
        )
    except Exception as exc:  # noqa: BLE001
        if _is_deadline_timeout(exc):
            raise SummaryDeadlineTimeout("summary upload deadline exceeded") from exc
        raise
    try:
        uploaded = _wait_active(
            client,
            uploaded,
            active_timeout,
            poll_interval,
            overall_deadline=primary_deadline,
        )
        last_err = None
        started = time.monotonic()
        attempts = 0
        try:
            # 파싱 실패 재시도는 응답 형식 문제만 다룬다. 데드라인 폴백은 이 루프 밖에서
            # 별도로 처리해 두 경로의 사유와 횟수가 섞이지 않게 한다.
            for _ in range(2):
                config = _generation_config(
                    types.ThinkingLevel.LOW,
                    _remaining_seconds(primary_deadline),
                )
                attempts += 1
                response = client.models.generate_content(
                    model=model,
                    contents=[uploaded, prompt],
                    config=config,
                )
                try:
                    result = _filter_observations(_parse(response), actor.duration_ms)
                except SummaryParseError as exc:
                    last_err = exc
                    continue
                path = "normal"
                break
            else:
                raise SummaryParseError(f"failed to parse after retry: {last_err}")
        except Exception as exc:
            if not _is_deadline_timeout(exc):
                raise
            try:
                config = _generation_config(
                    types.ThinkingLevel.MINIMAL,
                    MINIMAL_FALLBACK_TIMEOUT_SECONDS,
                )
                attempts += 1
                response = client.models.generate_content(
                    model=model,
                    contents=[uploaded, prompt],
                    config=config,
                )
            except Exception as fallback_exc:  # noqa: BLE001
                if _is_deadline_timeout(fallback_exc):
                    raise SummaryDeadlineTimeout(
                        "minimal fallback deadline exceeded"
                    ) from fallback_exc
                raise
            result = _filter_observations(_parse(response), actor.duration_ms)
            path = "deadline_minimal_fallback"
        _log_generation(
            model, time.monotonic() - started, attempts, path, response
        )
        if cache_path is not None:
            cache_path.parent.mkdir(parents=True, exist_ok=True)
            cache_path.write_text(result.model_dump_json(), encoding="utf-8")
        return result
    finally:
        try:
            client.files.delete(name=uploaded.name)
        except Exception:  # noqa: BLE001
            pass
