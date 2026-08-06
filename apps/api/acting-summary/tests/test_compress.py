import subprocess
from pathlib import Path

from acting_llm import media
from acting_summary import compress


def _make_file(tmp_path: Path, size: int) -> Path:
    p = tmp_path / "v.mp4"
    p.write_bytes(b"\0" * size)
    return p


def test_compression_and_audio_extraction_share_one_ffmpeg_lock():
    assert compress._FFMPEG_LOCK is media._FFMPEG_LOCK


def test_small_file_skipped(tmp_path):
    src = _make_file(tmp_path, 100)
    assert compress.compress_for_gemini(str(src), min_bytes=1000) == str(src)


def test_no_ffmpeg_returns_original(tmp_path, monkeypatch):
    src = _make_file(tmp_path, 100)
    monkeypatch.setattr(compress.shutil, "which", lambda _: None)
    assert compress.compress_for_gemini(str(src), min_bytes=10) == str(src)


def test_ffmpeg_failure_returns_original_and_cleans_up(tmp_path, monkeypatch):
    src = _make_file(tmp_path, 100)
    monkeypatch.setattr(compress.shutil, "which", lambda _: "/usr/bin/ffmpeg")

    def boom(*a, **k):
        raise subprocess.CalledProcessError(1, "ffmpeg")

    monkeypatch.setattr(compress.subprocess, "run", boom)
    assert compress.compress_for_gemini(str(src), min_bytes=10) == str(src)
    assert not (tmp_path / "v.gemini.mp4").exists()


def test_timeout_returns_original(tmp_path, monkeypatch):
    src = _make_file(tmp_path, 100)
    monkeypatch.setattr(compress.shutil, "which", lambda _: "/usr/bin/ffmpeg")

    def slow(*a, **k):
        raise subprocess.TimeoutExpired("ffmpeg", 1)

    monkeypatch.setattr(compress.subprocess, "run", slow)
    assert compress.compress_for_gemini(str(src), min_bytes=10, timeout=1) == str(src)


def test_bigger_output_discarded(tmp_path, monkeypatch):
    src = _make_file(tmp_path, 100)
    monkeypatch.setattr(compress.shutil, "which", lambda _: "/usr/bin/ffmpeg")

    def fake_run(cmd, **k):
        Path(cmd[-1]).write_bytes(b"\0" * 200)  # 원본보다 큰 결과물

    monkeypatch.setattr(compress.subprocess, "run", fake_run)
    assert compress.compress_for_gemini(str(src), min_bytes=10) == str(src)
    assert not (tmp_path / "v.gemini.mp4").exists()


def test_smaller_output_used(tmp_path, monkeypatch):
    src = _make_file(tmp_path, 100)
    monkeypatch.setattr(compress.shutil, "which", lambda _: "/usr/bin/ffmpeg")

    def fake_run(cmd, **k):
        Path(cmd[-1]).write_bytes(b"\0" * 10)

    monkeypatch.setattr(compress.subprocess, "run", fake_run)
    out = compress.compress_for_gemini(str(src), min_bytes=10)
    assert out == str(tmp_path / "v.gemini.mp4")
    assert Path(out).stat().st_size == 10
