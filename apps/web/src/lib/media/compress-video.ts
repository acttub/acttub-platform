import { abortError, isAbortError, throwIfAborted } from "./abort";
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
  } catch (error) {
    if (options.signal?.aborted || isAbortError(error)) throw abortError(options.signal);
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
    const primaryVideoTrack = await input.getPrimaryVideoTrack();
    throwIfAborted(options.signal);
    if (!primaryVideoTrack) return file;

    const primaryAudioTrack = await input.getPrimaryAudioTrack();
    throwIfAborted(options.signal);

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
        // 인자를 생략하면 파일 전체 패킷을 스캔하므로 fps 추정에 충분한 표본만 읽는다.
        const packetStats = await track.computePacketStats(200);
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
  } catch (error) {
    if (
      options.signal?.aborted ||
      isAbortError(error) ||
      error instanceof media.ConversionCanceledError
    ) {
      throw abortError(options.signal);
    }
    return file;
  } finally {
    options.signal?.removeEventListener("abort", onInputAbort);
    input.dispose();
  }
}
