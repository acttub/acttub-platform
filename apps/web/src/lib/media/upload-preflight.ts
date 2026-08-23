import { MAX_DURATION_MS, MAX_UPLOAD_BYTES } from "../config/env";
import {
  compressVideo,
  type CompressVideoOptions,
} from "./compress-video";
import { throwIfAborted } from "./abort";
import { videoDuration } from "./video-duration";

type DurationResolver = (file: File, signal?: AbortSignal) => Promise<number>;
type VideoCompressor = (
  file: File,
  durationSec: number,
  options?: CompressVideoOptions,
) => Promise<File>;

export type PrepareVideoUploadOptions = {
  compressor?: VideoCompressor;
  durationResolver?: DurationResolver;
  onCompressionProgress?: (progress: number) => void;
  signal?: AbortSignal;
  /** 계측용 시계. 테스트가 갈아 끼운다. */
  now?: () => number;
};

export type PreparedVideoUpload = {
  durationMs: number;
  file: File;
  wasCompressed: boolean;
  /**
   * 압축 구간 소요(ms). 압축을 건너뛰어도(WebCodecs 없음·작은 파일) 그 판단에 걸린
   * 시간이 담긴다 — 브라우저 구간 계측(SOMA-381)의 절반이고, 나머지 절반(업로드)은
   * startVideoUpload 가 잰다.
   */
  compressMs: number;
};

const SUPPORTED_VIDEO_TYPES = new Set(["video/mp4", "video/quicktime"]);

export async function prepareVideoUpload(
  file: File,
  options: PrepareVideoUploadOptions = {},
): Promise<PreparedVideoUpload> {
  throwIfAborted(options.signal);
  const contentType = file.type.trim().toLowerCase();
  if (!SUPPORTED_VIDEO_TYPES.has(contentType)) {
    throw new Error("MP4 또는 MOV 영상만 업로드할 수 있어요.");
  }
  if (file.size < 1) throw new Error("비어 있는 영상은 업로드할 수 없어요.");

  const resolveDuration = options.durationResolver ?? videoDuration;
  const durationMs = await resolveDuration(file, options.signal);
  throwIfAborted(options.signal);
  if (!Number.isInteger(durationMs) || durationMs < 1 || durationMs > MAX_DURATION_MS) {
    throw new Error("영상은 5분 이하여야 해요.");
  }

  const compressor = options.compressor ?? compressVideo;
  const now = options.now ?? (() => Date.now());
  const compressStartedAt = now();
  const uploadFile = await compressor(file, durationMs / 1000, {
    signal: options.signal,
    onProgress: options.onCompressionProgress,
  });
  const compressMs = Math.max(0, Math.round(now() - compressStartedAt));
  throwIfAborted(options.signal);
  if (uploadFile.size > MAX_UPLOAD_BYTES) {
    throw new Error(
      "이 브라우저에서는 영상을 충분히 줄이지 못했어요. 다른 브라우저를 사용하거나 파일 크기를 줄여 다시 올려 주세요.",
    );
  }

  return {
    durationMs,
    file: uploadFile,
    wasCompressed: uploadFile !== file,
    compressMs,
  };
}
