from pathlib import Path

import pytest

from acting_llm import openai_client


class _FakeResponse:
    def __init__(self, status_code, payload=None):
        self.status_code = status_code
        self._payload = payload or {}

    @property
    def is_success(self):
        return 200 <= self.status_code < 300

    def json(self):
        return self._payload


class _FakeClient:
    def __init__(self, response, captured, **_kwargs):
        self._response = response
        self._captured = captured

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def post(self, url, **kwargs):
        self._captured.append((url, kwargs))
        return self._response


def test_generate_text_sends_plain_response_request_and_returns_usage(
    monkeypatch,
):
    captured = []
    response = _FakeResponse(
        200,
        {
            "output": [
                {"content": [{"type": "output_text", "text": "  평문 응답  "}]}
            ],
            "usage": {
                "input_tokens": 11,
                "output_tokens": 3,
                "total_tokens": 14,
            },
        },
    )
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setenv("OPENAI_CHAT_MODEL", "test-model")
    monkeypatch.setattr(
        openai_client.httpx,
        "Client",
        lambda **kwargs: _FakeClient(response, captured, **kwargs),
    )

    text, usage = openai_client.generate_text("system", "prompt")

    assert text == "평문 응답"
    assert (usage.prompt, usage.completion, usage.total) == (11, 3, 14)
    _, request = captured[0]
    assert request["json"] == {
        "model": "test-model",
        "instructions": "system",
        "input": "prompt",
    }


def test_legacy_openai_transcribe_contract_and_model_variable_remain(
    monkeypatch,
    tmp_path,
):
    captured = []
    response = _FakeResponse(200, {"text": "받아쓰기", "usage": {}})
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setenv("OPENAI_TRANSCRIBE_MODEL", "test-transcribe-model")
    monkeypatch.setattr(
        openai_client.httpx,
        "Client",
        lambda **kwargs: _FakeClient(response, captured, **kwargs),
    )
    audio_path = Path(tmp_path) / "input.mp3"
    audio_path.write_bytes(b"mp3")

    text, usage = openai_client.transcribe_audio(audio_path, "transcribe prompt")

    assert text == "받아쓰기"
    assert usage.total == 0
    url, request = captured[0]
    assert url.endswith("/audio/transcriptions")
    assert request["data"] == {
        "model": "test-transcribe-model",
        "response_format": "json",
        "prompt": "transcribe prompt",
    }
    assert request["files"]["file"] == ("audio.mp3", b"mp3", "audio/mpeg")


def test_missing_api_key_raises_clear_error_without_secret(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    with pytest.raises(RuntimeError, match="OPENAI_API_KEY 환경변수가 필요합니다"):
        openai_client.generate_text("system", "prompt")


@pytest.mark.parametrize("status", [429, 503])
def test_retry_policy_matches_source(monkeypatch, status):
    responses = [
        _FakeResponse(status),
        _FakeResponse(status),
        _FakeResponse(status),
        _FakeResponse(200),
    ]
    delays = []

    class SequenceClient:
        def __init__(self, **_kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

    monkeypatch.setattr(openai_client.httpx, "Client", SequenceClient)
    monkeypatch.setattr(openai_client.time, "sleep", delays.append)

    response = openai_client._retrying_request(lambda _client: responses.pop(0))

    assert response.status_code == 200
    assert delays == [1.0, 2.0, 4.0]
