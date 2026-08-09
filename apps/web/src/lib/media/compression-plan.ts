// 모바일 앱(apps/mobile/lib/compress.ts)과 같은 규격이다. 목표를 서버의 재압축
// 기준(acting-summary compress.py MIN_BYTES = 15MB) 아래로 두면 업로드본이 그대로
// Gemini로 가고 서버 ffmpeg 단계가 통째로 빠진다. 어차피 Gemini가 768px로
// 다운샘플하므로 그보다 크게 인코딩해 봐야 인코딩·전송 시간만 늘어난다.
export const TARGET_OUTPUT_BYTES = 6 * 1024 * 1024;
export const SKIP_COMPRESSION_BYTES = 8 * 1024 * 1024;
export const MAX_VIDEO_BITRATE = 1_200_000;
export const MIN_VIDEO_BITRATE = 300_000;
export const AUDIO_BITRATE = 64_000;
export const MAX_LONG_EDGE = 720;
export const MAX_FRAME_RATE = 30;

export function shouldSkipCompression(sizeBytes: number): boolean {
  return sizeBytes <= SKIP_COMPRESSION_BYTES;
}

// 하한이 없으면 5분 영상이 95kbps로 인코딩돼 화면이 뭉개진다. 하한에 걸리면
// 산출물은 목표(6MB)를 넘어 최대 ~13MB가 되는데, 그래도 서버 재압축 기준 15MB
// 아래라 의도한 경로는 그대로 유지된다.
export function computeVideoBitrate(durationSec: number): number {
  const targetBitrate =
    Math.floor((0.95 * TARGET_OUTPUT_BYTES * 8) / durationSec) - AUDIO_BITRATE;
  return Math.min(
    MAX_VIDEO_BITRATE,
    Math.max(MIN_VIDEO_BITRATE, targetBitrate),
  );
}

export function computeOutputDimensions(
  displayWidth: number,
  displayHeight: number,
): { width?: number; height?: number } {
  if (Math.max(displayWidth, displayHeight) <= MAX_LONG_EDGE) return {};
  return displayWidth >= displayHeight
    ? { width: MAX_LONG_EDGE }
    : { height: MAX_LONG_EDGE };
}

export function computeFrameRate(averagePacketRate: number): number | undefined {
  return averagePacketRate > MAX_FRAME_RATE ? MAX_FRAME_RATE : undefined;
}
