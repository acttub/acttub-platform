import { abortError, throwIfAborted } from "./abort";
import {
  AUDIO_BITRATE,
  computeFrameRate,
  computeOutputDimensions,
  computeVideoBitrate,
  shouldSkipCompression,
} from "./compression-plan";

export type CompressVideoOptions = {
  onProgress?: (progress: number) => void;
  signal?: AbortSignal;
};

export type CompressionRuntime = {
  hasVideoWebCodecs: () => boolean;
  loadAacEncoder: () => Promise<{
    registerAacEncoder: () => void;
  }>;
  loadMedia: () => Promise<typeof import("mediabunny")>;
};

const DEFAULT_RUNTIME: CompressionRuntime = {
  hasVideoWebCodecs: () =>
    typeof VideoDecoder !== "undefined" && typeof VideoEncoder !== "undefined",
  loadAacEncoder: () => import("@mediabunny/aac-encoder"),
  loadMedia: () => import("mediabunny"),
};

function compressedFileName(name: string): string {
  const baseName = name.replace(/\.[^.]+$/, "") || "video";
  return `${baseName}.mp4`;
}

export async function compressVideo(
  file: File,
  durationSec: number,
  options: CompressVideoOptions = {},
  runtime: CompressionRuntime = DEFAULT_RUNTIME,
): Promise<File> {
  throwIfAborted(options.signal);
  if (shouldSkipCompression(file.size) || !runtime.hasVideoWebCodecs()) return file;

  let media: typeof import("mediabunny");
  try {
    media = await runtime.loadMedia();
    throwIfAborted(options.signal);
  } catch {
    if (options.signal?.aborted) throw abortError(options.signal);
    return file;
  }

  const input = new media.Input({
    source: new media.BlobSource(file),
    formats: [media.MP4, media.QTFF],
  });
  const onInputAbort = () => input.dispose();
  options.signal?.addEventListener("abort", onInputAbort, { once: true });

  try {
    throwIfAborted(options.signal);
    const videoTracks = await input.getVideoTracks();
    throwIfAborted(options.signal);
    const audioTracks = await input.getAudioTracks();
    throwIfAborted(options.signal);
    // tracks:"primary" 변환은 비-primary 트랙을 discardedTracks에도 남기지 않고 버린다.
    // 저장본이 곧 재생본이므로 다중 트랙 입력은 손실 없이 원본을 유지한다.
    if (videoTracks.length > 1 || audioTracks.length > 1) return file;
    const primaryVideoTrack = videoTracks[0] ?? null;
    if (!primaryVideoTrack) return file;
    const primaryAudioTrack = audioTracks[0] ?? null;

    if (primaryAudioTrack) {
      const numberOfChannels = await primaryAudioTrack.getNumberOfChannels();
      throwIfAborted(options.signal);
      const sampleRate = await primaryAudioTrack.getSampleRate();
      throwIfAborted(options.signal);
      const canEncodeSourceAudio = await media.canEncodeAudio("aac", {
        numberOfChannels,
        sampleRate,
        bitrate: AUDIO_BITRATE,
      });
      throwIfAborted(options.signal);

      if (!canEncodeSourceAudio) {
        const { registerAacEncoder } = await runtime.loadAacEncoder();
        throwIfAborted(options.signal);
        registerAacEncoder();
      }
    }

    const target = new media.BufferTarget();
    const output = new media.Output({
      format: new media.Mp4OutputFormat({ fastStart: "in-memory" }),
      target,
    });
    const conversion = await media.Conversion.init({
      input,
      output,
      tracks: "primary",
      showWarnings: false,
      video: async (track) => {
        throwIfAborted(options.signal);
        const displayWidth = await track.getDisplayWidth();
        throwIfAborted(options.signal);
        const displayHeight = await track.getDisplayHeight();
        throwIfAborted(options.signal);
        // metadataOnly 순회라 미디어 본문은 읽지 않는다 — 앞부분 표본만 보면
        // 저fps 도입부 뒤 고fps 구간을 놓치므로 전체 타임라인으로 평균을 낸다.
        const packetStats = await track.computePacketStats();
        throwIfAborted(options.signal);
        const frameRate = computeFrameRate(packetStats.averagePacketRate);

        return {
          codec: "avc",
          bitrate: computeVideoBitrate(durationSec),
          forceTranscode: true,
          ...computeOutputDimensions(displayWidth, displayHeight),
          ...(frameRate === undefined ? {} : { frameRate }),
        };
      },
      audio: {
        codec: "aac",
        bitrate: AUDIO_BITRATE,
        forceTranscode: true,
      },
    });
    throwIfAborted(options.signal);

    const hasPrimaryVideo = conversion.utilizedTracks.includes(primaryVideoTrack);
    const lostPrimaryAudio =
      primaryAudioTrack !== null &&
      (!conversion.utilizedTracks.includes(primaryAudioTrack) ||
        conversion.discardedTracks.some(({ track }) => track === primaryAudioTrack));
    if (!conversion.isValid || !hasPrimaryVideo || lostPrimaryAudio) return file;

    conversion.onProgress = (progress) => {
      options.onProgress?.(Math.min(0.99, Math.max(0, progress)));
    };
    const onAbort = () => {
      void conversion.cancel().catch(() => undefined);
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });

    try {
      throwIfAborted(options.signal);
      await conversion.execute();
      throwIfAborted(options.signal);
    } finally {
      options.signal?.removeEventListener("abort", onAbort);
    }

    options.onProgress?.(1);
    const buffer = target.buffer;
    if (!buffer) return file;

    const compressed = new File([buffer], compressedFileName(file.name), {
      type: "video/mp4",
      lastModified: file.lastModified,
    });
    return compressed.size < file.size ? compressed : file;
  } catch {
    // 취소 여부는 signal로만 가른다 — WebCodecs가 자체적으로 던지는 AbortError를
    // 사용자 취소로 오인하면 원본 폴백 대신 조용한 실패가 된다.
    if (options.signal?.aborted) throw abortError(options.signal);
    return file;
  } finally {
    options.signal?.removeEventListener("abort", onInputAbort);
    input.dispose();
  }
}
