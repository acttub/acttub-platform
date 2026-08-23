import assert from "node:assert/strict";
import { File } from "node:buffer";
import { test } from "node:test";

import "./ts-module-loader.mjs";

const { MAX_UPLOAD_BYTES } = await import("../src/lib/config/env.ts");
const { SKIP_COMPRESSION_BYTES } = await import(
  "../src/lib/media/compression-plan.ts"
);
const { compressVideo } = await import("../src/lib/media/compress-video.ts");
const { prepareVideoUpload } = await import(
  "../src/lib/media/upload-preflight.ts"
);

function createCompressionRuntime(options = {}) {
  const state = {
    cancelCalls: 0,
    disposeCalls: 0,
    executeCalls: 0,
    registerCalls: 0,
  };
  const videoTrack = {
    getDisplayWidth: async () => 1920,
    getDisplayHeight: async () => 1080,
    computePacketStats:
      options.computePacketStats ??
      (async () => ({ averagePacketRate: 60, averageBitrate: 0, packetCount: 60 })),
  };
  const audioTrack =
    options.withAudio === false
      ? null
      : {
          getNumberOfChannels: async () => 6,
          getSampleRate: async () => 44_100,
        };
  const videoTracks = [videoTrack, ...(options.extraVideoTracks ?? [])];
  const audioTracks = audioTrack
    ? [audioTrack, ...(options.extraAudioTracks ?? [])]
    : [];

  class ConversionCanceledError extends Error {}
  class Input {
    getVideoTracks = async () => videoTracks;
    getAudioTracks = async () => audioTracks;
    dispose() {
      state.disposeCalls += 1;
      options.onDispose?.();
    }
  }
  class BlobSource {}
  class BufferTarget {
    buffer = null;
  }
  class Mp4OutputFormat {}
  class Output {
    constructor({ target }) {
      this.target = target;
    }
  }
  class Conversion {
    static async init(initOptions) {
      state.initOptions = initOptions;
      await initOptions.video(videoTrack);
      const utilizedTracks = [];
      if (options.utilizeVideo !== false) utilizedTracks.push(videoTrack);
      if (audioTrack && !options.discardAudio) utilizedTracks.push(audioTrack);
      const conversion = {
        discardedTracks:
          audioTrack && options.discardAudio ? [{ track: audioTrack }] : [],
        isValid: options.isValid !== false,
        utilizedTracks,
        onProgress: undefined,
        async cancel() {
          state.cancelCalls += 1;
          options.onCancel?.(ConversionCanceledError);
        },
        async execute() {
          state.executeCalls += 1;
          if (options.execute) {
            return options.execute({
              ConversionCanceledError,
              conversion,
              state,
              target: initOptions.output.target,
            });
          }
          conversion.onProgress?.(1);
          initOptions.output.target.buffer = new ArrayBuffer(1024);
        },
      };
      state.conversion = conversion;
      return conversion;
    }
  }

  return {
    runtime: {
      hasVideoWebCodecs: () => true,
      loadAacEncoder: async () => ({
        registerAacEncoder: () => {
          state.registerCalls += 1;
        },
      }),
      loadMedia: async () => ({
        BlobSource,
        BufferTarget,
        Conversion,
        ConversionCanceledError,
        Input,
        MP4: {},
        Mp4OutputFormat,
        Output,
        QTFF: {},
        canEncodeAudio: async () => options.canEncodeAudio ?? true,
      }),
    },
    state,
  };
}

test("preflight는 선택된 파일의 길이를 await한 뒤 그 값을 반환한다", async () => {
  const selectedFile = new File(["video"], "selected.mp4", {
    type: "video/mp4",
  });
  let resolvedFile;

  const prepared = await prepareVideoUpload(selectedFile, {
    durationResolver: async (file) => {
      resolvedFile = file;
      return 123_456;
    },
    compressor: async (file) => file,
  });

  assert.equal(resolvedFile, selectedFile);
  assert.equal(prepared.file, selectedFile);
  assert.equal(prepared.durationMs, 123_456);
  assert.equal(prepared.wasCompressed, false);
});

test("preflight는 MP4와 MOV가 아닌 파일을 metadata 조회 전에 거부한다", async () => {
  const file = new File(["text"], "notes.txt", { type: "text/plain" });
  let durationCalls = 0;

  await assert.rejects(
    prepareVideoUpload(file, {
      durationResolver: async () => {
        durationCalls += 1;
        return 1_000;
      },
      compressor: async (candidate) => candidate,
    }),
    /MP4 또는 MOV 영상만 업로드할 수 있어요/,
  );
  assert.equal(durationCalls, 0);
});

test("preflight는 5분을 초과한 영상을 압축 전에 거부한다", async () => {
  const file = new File(["video"], "long.mov", { type: "video/quicktime" });
  let compressionCalls = 0;

  await assert.rejects(
    prepareVideoUpload(file, {
      durationResolver: async () => 300_001,
      compressor: async (candidate) => {
        compressionCalls += 1;
        return candidate;
      },
    }),
    /5분 이하여야 해요/,
  );
  assert.equal(compressionCalls, 0);
});

test("preflight는 압축 또는 폴백 뒤 실제 업로드 파일이 100MB를 넘으면 거부한다", async () => {
  const file = {
    name: "large.mp4",
    type: "video/mp4",
    size: SKIP_COMPRESSION_BYTES + 1,
  };
  const oversizedResult = {
    name: "large.mp4",
    type: "video/mp4",
    size: MAX_UPLOAD_BYTES + 1,
  };

  await assert.rejects(
    prepareVideoUpload(file, {
      durationResolver: async () => 60_000,
      compressor: async () => oversizedResult,
    }),
    /다른 브라우저를 사용하거나 파일 크기를 줄여/,
  );
});

test("WebCodecs가 없으면 압축 대상도 원본으로 폴백한다", async () => {
  const file = {
    name: "large.mp4",
    type: "video/mp4",
    size: SKIP_COMPRESSION_BYTES + 1,
  };

  assert.equal(await compressVideo(file, 60), file);
});

test("이미 abort된 압축은 원본 폴백이 아니라 AbortError를 전파한다", async () => {
  const controller = new AbortController();
  controller.abort();
  const file = {
    name: "large.mp4",
    type: "video/mp4",
    size: SKIP_COMPRESSION_BYTES + 1,
  };

  await assert.rejects(
    compressVideo(file, 60, { signal: controller.signal }),
    (error) => error instanceof Error && error.name === "AbortError",
  );
});

test("AAC 소스 설정을 인코딩할 수 없으면 fallback encoder를 등록한다", async () => {
  const { runtime, state } = createCompressionRuntime({ canEncodeAudio: false });
  const file = {
    name: "large.mov",
    type: "video/quicktime",
    size: SKIP_COMPRESSION_BYTES + 1,
  };

  const result = await compressVideo(file, 60, {}, runtime);

  assert.notEqual(result, file);
  assert.equal(result.type, "video/mp4");
  assert.equal(state.registerCalls, 1);
});

test("다중 audio 트랙 입력은 트랙 손실을 피해 원본으로 폴백한다", async () => {
  const { runtime, state } = createCompressionRuntime({
    extraAudioTracks: [{ getNumberOfChannels: async () => 2, getSampleRate: async () => 48_000 }],
  });
  const file = {
    name: "multi.mov",
    type: "video/quicktime",
    size: SKIP_COMPRESSION_BYTES + 1,
  };

  assert.equal(await compressVideo(file, 60, {}, runtime), file);
  assert.equal(state.executeCalls, 0);
});

test("signal 없이 발생한 AbortError는 취소가 아니라 원본 폴백으로 처리한다", async () => {
  const { runtime } = createCompressionRuntime({
    execute: async () => {
      const error = new Error("encoder reset");
      error.name = "AbortError";
      throw error;
    },
  });
  const file = {
    name: "large.mp4",
    type: "video/mp4",
    size: SKIP_COMPRESSION_BYTES + 1,
  };

  assert.equal(await compressVideo(file, 60, {}, runtime), file);
});

test("primary audio가 discard되거나 변환이 invalid면 원본으로 폴백한다", async () => {
  for (const runtimeOptions of [{ discardAudio: true }, { isValid: false }]) {
    const { runtime, state } = createCompressionRuntime(runtimeOptions);
    const file = {
      name: "large.mp4",
      type: "video/mp4",
      size: SKIP_COMPRESSION_BYTES + 1,
    };

    assert.equal(await compressVideo(file, 60, {}, runtime), file);
    assert.equal(state.executeCalls, 0);
  }
});

test("변환 progress 1은 execute 중 0.99로 제한되고 resolve 뒤에만 1이 된다", async () => {
  const { runtime } = createCompressionRuntime();
  const file = {
    name: "large.mp4",
    type: "video/mp4",
    size: SKIP_COMPRESSION_BYTES + 1,
  };
  const progress = [];

  await compressVideo(
    file,
    60,
    { onProgress: (value) => progress.push(value) },
    runtime,
  );

  assert.deepEqual(progress, [0.99, 1]);
});

test("execute 예외는 원본으로 폴백한다", async () => {
  const { runtime } = createCompressionRuntime({
    execute: async () => {
      throw new Error("encoder failed");
    },
  });
  const file = {
    name: "large.mp4",
    type: "video/mp4",
    size: SKIP_COMPRESSION_BYTES + 1,
  };

  assert.equal(await compressVideo(file, 60, {}, runtime), file);
});

test("execute 중 abort는 Conversion.cancel을 호출하고 AbortError를 전파한다", async () => {
  let rejectExecute;
  const { runtime, state } = createCompressionRuntime({
    execute: async () =>
      new Promise((_, reject) => {
        rejectExecute = reject;
      }),
    onCancel: (ConversionCanceledError) =>
      rejectExecute(new ConversionCanceledError("canceled")),
  });
  const controller = new AbortController();
  const file = {
    name: "large.mp4",
    type: "video/mp4",
    size: SKIP_COMPRESSION_BYTES + 1,
  };
  const result = compressVideo(file, 60, { signal: controller.signal }, runtime);

  for (let attempt = 0; attempt < 20 && state.executeCalls === 0; attempt += 1) {
    await Promise.resolve();
  }
  assert.equal(state.executeCalls, 1);
  controller.abort();

  await assert.rejects(
    result,
    (error) => error instanceof Error && error.name === "AbortError",
  );
  assert.equal(state.cancelCalls, 1);
});

test("packet scan 중 abort는 Input.dispose로 진행 중 read를 중단한다", async () => {
  let rejectPacketScan;
  const { runtime, state } = createCompressionRuntime({
    computePacketStats: async () =>
      new Promise((_, reject) => {
        rejectPacketScan = reject;
      }),
    onDispose: () => rejectPacketScan?.(new Error("input disposed")),
  });
  const controller = new AbortController();
  const file = {
    name: "large.mp4",
    type: "video/mp4",
    size: SKIP_COMPRESSION_BYTES + 1,
  };
  const result = compressVideo(file, 60, { signal: controller.signal }, runtime);

  await Promise.resolve();
  await Promise.resolve();
  controller.abort();

  await assert.rejects(
    result,
    (error) => error instanceof Error && error.name === "AbortError",
  );
  assert.ok(state.disposeCalls >= 1);
});

test("SOMA-381: 압축 구간 소요를 재서 돌려준다", async () => {
  const file = new File([new Uint8Array(1_000)], "take.mp4", { type: "video/mp4" });
  let clock = 0;
  const prepared = await prepareVideoUpload(file, {
    durationResolver: async () => 7_000,
    compressor: async (given) => given, // 압축 스킵(원본 그대로)
    now: () => {
      const at = clock;
      clock += 250; // 압축 시작·종료 두 번 읽는 사이 250ms
      return at;
    },
  });

  assert.equal(prepared.compressMs, 250);
  assert.equal(prepared.wasCompressed, false);
});
