"""Gemini 업로드 전 영상 압축.

Gemini는 영상을 내부에서 1fps 샘플링 + 프레임당 최대 768px로 다운샘플링해
분석하므로, 그 이상의 해상도·프레임레이트는 업로드 시간과 처리 실패율만
높인다. 여기서 768px·10fps·모노 오디오로 줄여도 분석 품질은 동일하다.

ultrafast 프리셋 + 시간제한을 걸고, 압축이 실패하거나 시간을 초과하면 원본을
그대로 사용한다. 스레드 수는 ffmpeg_threads()가 인스턴스 코어 수에서 정한다
(2026-08-09 이전에는 Render 무료 티어를 가정해 1로 박혀 있었다).
"""

import shutil
import subprocess
from pathlib import Path

from acting_llm.media import _FFMPEG_LOCK, ffmpeg_threads

# 이보다 작은 파일은 압축해도 이득이 적어 건너뛴다.
MIN_BYTES = 15 * 1024 * 1024
# free tier에서 5분 영상 인코딩이 이 시간을 넘기면 포기하고 원본을 쓴다.
# 4K 원본은 디코딩만으로도 오래 걸리므로 10분까지 둔다 (워커 스레드라 루프는 안 막힘).
TIMEOUT_SEC = 600.0


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
        # 4K 디코더는 스레드당 프레임 버퍼를 잡아 기본(auto)이면 수백 MB를 먹는다.
        # 그래서 무제한(auto)이 아니라 ffmpeg_threads()로 코어 수만큼(최대 4) 준다.
        "-threads",
        ffmpeg_threads(),
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
        "-threads",
        ffmpeg_threads(),
        str(dst),
    ]
    try:
        with _FFMPEG_LOCK:
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
