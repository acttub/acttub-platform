import os
import shutil
import subprocess
import tempfile
import threading
from pathlib import Path

_FFMPEG_TIMEOUT_SECONDS = 120
# ffmpeg 2개가 겹치면 작은 인스턴스에서 OOM — 세 호출 모두 한 번에 하나만 돌린다.
# 대신 한 번에 도는 그 하나가 코어를 다 쓰게 아래 ffmpeg_threads()로 스레드를 준다.
_FFMPEG_LOCK = threading.Lock()

# 스레드 수 상한. 이보다 코어가 많아도 인코딩 이득이 급격히 줄고 메모리만 는다.
_FFMPEG_MAX_THREADS = 4


def ffmpeg_threads() -> str:
    """ffmpeg -threads 값.

    2026-08-09까지 "1"로 박혀 있었다. 근거는 Render 무료 티어(0.1 CPU · 512MB)였는데
    운영이 EC2로 옮겨간 뒤에도 그대로여서, 코어를 놀리면서 분석이 느렸다.
    락으로 동시 실행을 이미 막아 두었으므로 한 번에 도는 하나는 코어를 다 써도 된다.
    FFMPEG_THREADS 로 덮어쓸 수 있다(작은 인스턴스로 되돌릴 때 "1").
    """
    override = os.environ.get("FFMPEG_THREADS", "").strip()
    if override:
        return override
    return str(max(1, min(_FFMPEG_MAX_THREADS, os.cpu_count() or 1)))


def clip_head(src_path: str | Path, duration_ms: int | float) -> Path:
    output_dir = Path(tempfile.mkdtemp(prefix="acttub-observation-"))
    output_path = output_dir / "first-two-minutes.mp4"
    try:
        with _FFMPEG_LOCK:
            subprocess.run(
                [
                "ffmpeg",
                "-hide_banner",
                "-loglevel",
                "error",
                "-threads",
                ffmpeg_threads(),
                "-i",
                str(src_path),
                "-t",
                f"{duration_ms / 1000:.3f}",
                "-map",
                "0:v:0",
                "-map",
                "0:a?",
                "-c:v",
                "libx264",
                "-c:a",
                "aac",
                "-pix_fmt",
                "yuv420p",
                "-movflags",
                "+faststart",
                "-y",
                str(output_path),
            ],
                check=True,
                capture_output=True,
                timeout=_FFMPEG_TIMEOUT_SECONDS,
            )
    except BaseException:
        shutil.rmtree(output_dir, ignore_errors=True)
        raise
    return output_path


def extract_audio(src_path: str | Path, duration_ms: int | float) -> Path:
    output_dir = Path(tempfile.mkdtemp(prefix="acttub-transcription-"))
    output_path = output_dir / "audio.mp3"
    try:
        with _FFMPEG_LOCK:
            subprocess.run(
                [
                "ffmpeg",
                "-hide_banner",
                "-loglevel",
                "error",
                "-threads",
                ffmpeg_threads(),
                "-i",
                str(src_path),
                "-t",
                f"{duration_ms / 1000:.3f}",
                "-vn",
                "-codec:a",
                "libmp3lame",
                "-q:a",
                "4",
                "-y",
                str(output_path),
            ],
                check=True,
                capture_output=True,
                timeout=_FFMPEG_TIMEOUT_SECONDS,
            )
    except BaseException:
        shutil.rmtree(output_dir, ignore_errors=True)
        raise
    return output_path
