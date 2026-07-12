"""Gemini 업로드 전 영상 압축.

Gemini는 영상을 내부에서 1fps 샘플링 + 프레임당 최대 768px로 다운샘플링해
분석하므로, 그 이상의 해상도·프레임레이트는 업로드 시간과 처리 실패율만
높인다. 여기서 768px·10fps·모노 오디오로 줄여도 분석 품질은 동일하다.

Render free tier는 CPU가 약하므로(0.1 CPU) ultrafast 프리셋 + 시간제한을
걸고, 압축이 실패하거나 시간을 초과하면 원본을 그대로 사용한다.
"""

import shutil
import subprocess
from pathlib import Path

# 이보다 작은 파일은 압축해도 이득이 적어 건너뛴다.
MIN_BYTES = 15 * 1024 * 1024
# free tier에서 인코딩이 이 시간을 넘기면 포기하고 원본을 쓴다.
# 4K 원본은 디코딩만으로도 오래 걸리므로 넉넉히 둔다 (워커 스레드라 루프는 안 막힘).
TIMEOUT_SEC = 300.0


def compress_for_gemini(
    video_path: str,
    *,
    min_bytes: int = MIN_BYTES,
    timeout: float = TIMEOUT_SEC,
) -> str:
    """압축본 경로를 반환. 압축 불가/불필요/실패 시 원본 경로를 그대로 반환.

    반환 경로가 원본과 다르면 호출자가 두 파일 모두 정리해야 한다.
    """
    src = Path(video_path)
    if src.stat().st_size <= min_bytes:
        return str(src)
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg is None:
        return str(src)
    dst = src.with_name(src.stem + ".gemini.mp4")
    cmd = [
        ffmpeg,
        "-y",
        "-i",
        str(src),
        "-vf",
        "scale=w=768:h=768:force_original_aspect_ratio=decrease:force_divisible_by=2",
        "-r",
        "10",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-crf",
        "28",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "64k",
        "-ac",
        "1",
        "-movflags",
        "+faststart",
        str(dst),
    ]
    try:
        subprocess.run(cmd, check=True, timeout=timeout, capture_output=True)
    except (subprocess.SubprocessError, OSError):
        dst.unlink(missing_ok=True)
        return str(src)
    if not dst.exists() or dst.stat().st_size == 0:
        dst.unlink(missing_ok=True)
        return str(src)
    if dst.stat().st_size >= src.stat().st_size:
        dst.unlink(missing_ok=True)
        return str(src)
    return str(dst)
