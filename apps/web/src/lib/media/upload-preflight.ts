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
};

export type PreparedVideoUpload = {
  durationMs: number;
  file: File;
  wasCompressed: boolean;
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
  const uploadFile = await compressor(file, durationMs / 1000, {
    signal: options.signal,
    onProgress: options.onCompressionProgress,
  });
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
  };
}
