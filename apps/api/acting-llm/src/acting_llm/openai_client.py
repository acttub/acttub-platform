import os
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx

API_ROOT = "https://api.openai.com/v1"
_ATTEMPTS = 4
_REQUEST_TIMEOUT_SECONDS = 120.0
_RETRY_STATUSES = {429, 503}


@dataclass(frozen=True)
class TokenUsage:
    prompt: int
    completion: int
    total: int


def _configuration() -> tuple[str, str, str]:
    key = os.environ.get("OPENAI_API_KEY", "").strip()
    chat_model = os.environ.get("OPENAI_CHAT_MODEL", "").strip() or "gpt-5.6-terra"
    transcribe_model = (
        os.environ.get("OPENAI_TRANSCRIBE_MODEL", "").strip() or "gpt-transcribe"
    )
    return key, chat_model, transcribe_model


def _required_configuration() -> tuple[str, str, str]:
    key, chat_model, transcribe_model = _configuration()
    if not key:
        raise RuntimeError("OpenAI 호출에는 OPENAI_API_KEY 환경변수가 필요합니다.")
    return key, chat_model, transcribe_model


def _retrying_request(
    request: Callable[[httpx.Client], httpx.Response],
) -> httpx.Response:
    delay = 1.0
    with httpx.Client(timeout=_REQUEST_TIMEOUT_SECONDS) as client:
        for attempt in range(_ATTEMPTS):
            try:
                response = request(client)
            except httpx.RequestError:
                if attempt == _ATTEMPTS - 1:
                    raise
                response = None

            if response is not None and response.status_code not in _RETRY_STATUSES:
                return response
            if response is not None and attempt == _ATTEMPTS - 1:
                return response

            time.sleep(delay)
            delay *= 2

    raise RuntimeError("OpenAI 요청을 완료하지 못했습니다.")


def _api_error(status: int, context: str) -> RuntimeError:
    if status in _RETRY_STATUSES:
        return RuntimeError(f"{context}: 지금 AI가 붐빕니다. 잠시 뒤 다시 시도해 주세요.")
    return RuntimeError(f"{context}: OpenAI가 HTTP {status}로 응답했습니다.")


def _token_usage(payload: dict[str, Any]) -> TokenUsage:
    usage = payload.get("usage")
    if not isinstance(usage, dict):
        usage = {}
    prompt = usage.get("input_tokens")
    completion = usage.get("output_tokens")
    total = usage.get("total_tokens")
    prompt = prompt if isinstance(prompt, int) else 0
    completion = completion if isinstance(completion, int) else 0
    total = total if isinstance(total, int) else prompt + completion
    return TokenUsage(prompt=prompt, completion=completion, total=total)


def _output_items(payload: dict[str, Any]) -> list[dict[str, Any]]:
    output = payload.get("output")
    if not isinstance(output, list):
        return []
    contents: list[dict[str, Any]] = []
    for item in output:
        if not isinstance(item, dict) or not isinstance(item.get("content"), list):
            continue
        contents.extend(content for content in item["content"] if isinstance(content, dict))
    return contents


def generate_text(system_instruction: str, prompt: str) -> tuple[str, TokenUsage]:
    key, chat_model, _ = _required_configuration()
    response = _retrying_request(
        lambda client: client.post(
            f"{API_ROOT}/responses",
            headers={
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
            },
            json={
                "model": chat_model,
                "instructions": system_instruction,
                "input": prompt,
            },
        )
    )
    if not response.is_success:
        raise _api_error(response.status_code, "OpenAI 생성 실패")

    payload = response.json()
    if not isinstance(payload, dict):
        raise RuntimeError("OpenAI 평문 응답을 읽지 못했습니다.")

    contents = _output_items(payload)
    output_text = payload.get("output_text")
    if isinstance(output_text, str):
        text = output_text.strip()
    else:
        text = "".join(
            content.get("text", "")
            for content in contents
            if content.get("type") == "output_text"
            and isinstance(content.get("text", ""), str)
        ).strip()

    if not text:
        refusal = " ".join(
            content["refusal"]
            for content in contents
            if isinstance(content.get("refusal"), str) and content["refusal"]
        )
        detail = f" ({refusal})" if refusal else ""
        raise RuntimeError(f"OpenAI 평문 응답이 비었습니다{detail}.")

    return text, _token_usage(payload)


def transcribe_audio(
    audio_path: str | Path, system_instruction: str
) -> tuple[str, TokenUsage]:
    key, _, transcribe_model = _required_configuration()
    audio = Path(audio_path).read_bytes()
    response = _retrying_request(
        lambda client: client.post(
            f"{API_ROOT}/audio/transcriptions",
            headers={"Authorization": f"Bearer {key}"},
            data={
                "model": transcribe_model,
                "response_format": "json",
                "prompt": system_instruction,
            },
            files={"file": ("audio.mp3", audio, "audio/mpeg")},
        )
    )
    if not response.is_success:
        raise _api_error(response.status_code, "OpenAI 받아쓰기 실패")

    payload = response.json()
    if not isinstance(payload, dict) or not isinstance(payload.get("text"), str):
        raise RuntimeError("OpenAI 받아쓰기 결과를 읽지 못했습니다.")
    return payload["text"], _token_usage(payload)
