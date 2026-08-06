import shutil
import subprocess
import tempfile
import threading
from pathlib import Path

_FFMPEG_TIMEOUT_SECONDS = 120
# 512MB 인스턴스에서 ffmpeg 2개가 겹치면 OOM — 세 호출 모두 한 번에 하나만 돌린다.
_FFMPEG_LOCK = threading.Lock()


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
                "1",
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
                "1",
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
