from pathlib import Path
from types import SimpleNamespace

import pytest

from acting_llm import gemini_client


class _FakeFiles:
    def __init__(self):
        self.uploads = []
        self.deleted = []
        self.uploaded = SimpleNamespace(name="files/audio")

    def upload(self, *, file, config):
        self.uploads.append((file, config))
        return self.uploaded

    def delete(self, *, name):
        self.deleted.append(name)


class _FakeModels:
    def __init__(self, response):
        self.response = response
        self.calls = []

    def generate_content(self, *, model, contents, config):
        self.calls.append((model, contents, config))
        return self.response


class _FakeClient:
    def __init__(self, response):
        self.files = _FakeFiles()
        self.models = _FakeModels(response)


def test_transcribe_audio_uploads_mp3_and_joins_structured_lines(
    monkeypatch,
    tmp_path,
):
    monkeypatch.delenv("GEMINI_TRANSCRIBE_MODEL", raising=False)
    response = SimpleNamespace(
        parsed=[" 첫 대사 ", "다음 대사", ""],
        usage_metadata=SimpleNamespace(
            prompt_token_count=11,
            candidates_token_count=3,
            total_token_count=14,
        ),
    )
    client = _FakeClient(response)
    audio_path = Path(tmp_path) / "input.mp3"
    audio_path.write_bytes(b"mp3")

    text, usage = gemini_client.transcribe_audio(
        audio_path,
        "transcribe prompt",
        client=client,
    )

    assert text == "첫 대사\n다음 대사"
    assert (usage.prompt, usage.completion, usage.total) == (11, 3, 14)
    uploaded_path, upload_config = client.files.uploads[0]
    assert uploaded_path == str(audio_path)
    assert upload_config.mime_type == "audio/mpeg"
    assert upload_config.http_options.timeout == 120_000
    model, contents, config = client.models.calls[0]
    assert model == "gemini-2.5-flash"
    assert contents == [client.files.uploaded]
    assert config.system_instruction == "transcribe prompt"
    assert config.response_mime_type == "application/json"
    assert config.response_schema == list[str]
    assert config.temperature == 0.0
    assert config.http_options.timeout == 120_000
    assert client.files.deleted == ["files/audio"]


def test_transcribe_audio_uses_model_override(monkeypatch, tmp_path):
    monkeypatch.setenv("GEMINI_TRANSCRIBE_MODEL", "gemini-transcribe-test")
    client = _FakeClient(SimpleNamespace(parsed=[], usage_metadata=None))

    gemini_client.transcribe_audio(
        tmp_path / "input.mp3",
        "prompt",
        client=client,
    )

    assert client.models.calls[0][0] == "gemini-transcribe-test"


def test_transcribe_audio_rejects_non_array_response_and_deletes_upload(tmp_path):
    client = _FakeClient(SimpleNamespace(parsed=None, text="서론: 받아쓰기입니다"))

    with pytest.raises(RuntimeError, match="Gemini 받아쓰기 결과를 읽지 못했습니다"):
        gemini_client.transcribe_audio(
            tmp_path / "input.mp3",
            "prompt",
            client=client,
        )

    assert client.files.deleted == ["files/audio"]
