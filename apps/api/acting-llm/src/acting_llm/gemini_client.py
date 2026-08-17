import json
import os
from pathlib import Path

from google.genai import types

from acting_llm.openai_client import TokenUsage


DEFAULT_TRANSCRIBE_MODEL = "gemini-2.5-flash"
_REQUEST_TIMEOUT_SECONDS = 120.0


def _http_options(timeout: float) -> types.HttpOptions:
    return types.HttpOptions(timeout=int(timeout * 1000))


def _transcribe_model() -> str:
    return (
        os.environ.get("GEMINI_TRANSCRIBE_MODEL", "").strip()
        or DEFAULT_TRANSCRIBE_MODEL
    )


def _transcript_lines(response) -> list[str]:
    parsed = getattr(response, "parsed", None)
    if not isinstance(parsed, list):
        text = getattr(response, "text", None)
        if isinstance(text, str):
            try:
                parsed = json.loads(text)
            except json.JSONDecodeError:
                parsed = None
    if not isinstance(parsed, list) or any(
        not isinstance(line, str) for line in parsed
    ):
        raise RuntimeError("Gemini 받아쓰기 결과를 읽지 못했습니다.")
    return [line.strip() for line in parsed if line.strip()]


def _token_usage(response) -> TokenUsage:
    usage = getattr(response, "usage_metadata", None)
    prompt = getattr(usage, "prompt_token_count", None)
    completion = getattr(usage, "candidates_token_count", None)
    total = getattr(usage, "total_token_count", None)
    prompt = prompt if isinstance(prompt, int) else 0
    completion = completion if isinstance(completion, int) else 0
    total = total if isinstance(total, int) else prompt + completion
    return TokenUsage(prompt=prompt, completion=completion, total=total)


def transcribe_audio(
    audio_path: str | Path,
    system_instruction: str,
    *,
    client,
) -> tuple[str, TokenUsage]:
    uploaded = client.files.upload(
        file=str(audio_path),
        config=types.UploadFileConfig(
            http_options=_http_options(_REQUEST_TIMEOUT_SECONDS),
            mime_type="audio/mpeg",
        ),
    )
    try:
        response = client.models.generate_content(
            model=_transcribe_model(),
            contents=[uploaded],
            config=types.GenerateContentConfig(
                http_options=_http_options(_REQUEST_TIMEOUT_SECONDS),
                system_instruction=system_instruction,
                response_mime_type="application/json",
                response_schema=list[str],
                temperature=0.0,
            ),
        )
        return "\n".join(_transcript_lines(response)), _token_usage(response)
    finally:
        try:
            client.files.delete(name=uploaded.name)
        except Exception:  # noqa: BLE001
            pass
