export const TARGET_OUTPUT_BYTES = 50 * 1024 * 1024;
export const SKIP_COMPRESSION_BYTES = 50 * 1024 * 1024;
export const MAX_VIDEO_BITRATE = 2_000_000;
export const AUDIO_BITRATE = 128_000;
export const MAX_LONG_EDGE = 1280;
export const MAX_FRAME_RATE = 30;

export function shouldSkipCompression(sizeBytes: number): boolean {
  return sizeBytes <= SKIP_COMPRESSION_BYTES;
}

export function computeVideoBitrate(durationSec: number): number {
  const targetBitrate =
    Math.floor((0.95 * TARGET_OUTPUT_BYTES * 8) / durationSec) - AUDIO_BITRATE;
  return Math.min(MAX_VIDEO_BITRATE, targetBitrate);
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
