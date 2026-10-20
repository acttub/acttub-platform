import assert from "node:assert/strict";
import { File } from "node:buffer";
import { registerHooks } from "node:module";
import { afterEach, beforeEach, test } from "node:test";

import "./ts-module-loader.mjs";

// 기본 런타임이 동적으로 불러오는 mediabunny 와 AAC 인코더를 대역 모듈로 바꿔 끼운다.
const fakeUrl = new URL("./fixtures/compress-video-mediabunny.mjs", import.meta.url).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "mediabunny" || specifier === "@mediabunny/aac-encoder") {
      return { url: fakeUrl, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const { fake } = await import(fakeUrl);
const { compressVideo, hasVideoWebCodecsSupport } = await import("../src/lib/media/compress-video.ts");
const { SKIP_COMPRESSION_BYTES } = await import("../src/lib/media/compression-plan.ts");

function videoTrack({ width = 1920, height = 1080, fps = 60 } = {}) {
  return {
    getDisplayWidth: async () => width,
    getDisplayHeight: async () => height,
    computePacketStats: async () => ({ averagePacketRate: fps, averageBitrate: 0, packetCount: 0 }),
  };
}

function audioTrack() {
  return { getNumberOfChannels: async () => 6, getSampleRate: async () => 44_100 };
}

function largeVideo(name = "take.mov") {
  return new File([new Uint8Array(SKIP_COMPRESSION_BYTES + 1)], name, {
    type: "video/quicktime",
    lastModified: 1_700_000_000_000,
  });
}

beforeEach(() => {
  fake.reset();
  fake.videoTracks = [videoTrack()];
  fake.audioTracks = [audioTrack()];
  fake.outputBytes = 1_000;
  globalThis.VideoDecoder = class {};
  globalThis.VideoEncoder = class {};
});

afterEach(() => {
  delete globalThis.VideoDecoder;
  delete globalThis.VideoEncoder;
});

test("WebCodecs 디코더와 인코더가 둘 다 있어야 압축을 지원한다고 본다", () => {
  assert.equal(hasVideoWebCodecsSupport(), true);
  delete globalThis.VideoEncoder;
  assert.equal(hasVideoWebCodecsSupport(), false);
  delete globalThis.VideoDecoder;
  assert.equal(hasVideoWebCodecsSupport(), false);
});

test("가로 60fps 영상은 긴 변 720px·30fps·1분 목표 비트레이트의 MP4로 줄인다", async () => {
  const file = largeVideo("take.mov");

  const result = await compressVideo(file, 60);

  assert.equal(result.name, "take.mp4");
  assert.equal(result.type, "video/mp4");
  assert.equal(result.size, 1_000);
  assert.equal(result.lastModified, 1_700_000_000_000);
  assert.deepEqual(fake.calls.videoConfig, {
    codec: "avc",
    hardwareAcceleration: "prefer-hardware",
    bitrate: 732_917,
    forceTranscode: true,
    width: 720,
    frameRate: 30,
  });
  assert.deepEqual(fake.calls.init.audio, { codec: "aac", bitrate: 64_000, forceTranscode: true });
  assert.equal(fake.calls.init.tracks, "primary");
  assert.deepEqual(
    fake.calls.init.input.options.formats.map((format) => format.name),
    ["MP4", "QTFF"],
  );
});

test("세로 24fps 5분 영상은 높이만 720px로 줄이고 fps는 그대로, 비트레이트는 하한을 쓴다", async () => {
  fake.videoTracks = [videoTrack({ width: 1080, height: 1920, fps: 24 })];

  await compressVideo(largeVideo(), 300);

  assert.deepEqual(fake.calls.videoConfig, {
    codec: "avc",
    hardwareAcceleration: "prefer-hardware",
    bitrate: 300_000,
    forceTranscode: true,
    height: 720,
  });
});

test("확장자만 있는 파일 이름은 video.mp4로 저장한다", async () => {
  const result = await compressVideo(largeVideo(".mov"), 60);

  assert.equal(result.name, "video.mp4");
});

test("브라우저가 원본 채널·샘플레이트의 AAC를 만들지 못하면 내장 AAC 인코더를 등록한다", async () => {
  fake.canEncodeAudio = false;

  const result = await compressVideo(largeVideo(), 60);

  assert.deepEqual(fake.calls.canEncodeAudio, [
    { codec: "aac", numberOfChannels: 6, sampleRate: 44_100, bitrate: 64_000 },
  ]);
  assert.equal(fake.calls.aacRegistrations, 1);
  assert.equal(result.type, "video/mp4");
});

test("오디오 없는 영상은 AAC 지원을 묻지 않고 영상만 줄인다", async () => {
  fake.audioTracks = [];

  const result = await compressVideo(largeVideo(), 60);

  assert.equal(result.size, 1_000);
  assert.deepEqual(fake.calls.canEncodeAudio, []);
});

test("영상 트랙이 없거나 둘 이상이면 변환하지 않고 원본을 쓴다", async () => {
  for (const tracks of [[], [videoTrack(), videoTrack()]]) {
    fake.reset();
    fake.videoTracks = tracks;
    fake.audioTracks = [audioTrack()];
    const file = largeVideo();

    assert.equal(await compressVideo(file, 60), file);
    assert.equal(fake.calls.init, null);
  }
});

test("변환 결과가 비었거나 원본보다 작지 않으면 원본을 쓴다", async () => {
  const empty = largeVideo();
  fake.conversion = () => ({ execute: async () => {} });
  assert.equal(await compressVideo(empty, 60), empty);

  const notSmaller = largeVideo();
  fake.conversion = () => ({});
  fake.outputBytes = notSmaller.size;
  assert.equal(await compressVideo(notSmaller, 60), notSmaller);
});

test("변환이 원본 오디오를 쓰면서도 버린 트랙으로 보고하면 원본을 쓴다", async () => {
  const [audio] = fake.audioTracks;
  let executed = false;
  fake.conversion = () => ({
    discardedTracks: [{ track: videoTrack(), reason: "undecodable_source_codec" }, { track: audio, reason: "no_encodable_target_codec" }],
    execute: async () => {
      executed = true;
    },
  });
  const file = largeVideo();

  assert.equal(await compressVideo(file, 60), file);
  assert.equal(executed, false);
});

test("압축 라이브러리를 불러오지 못하면 원본을 쓰고, 그 사이 취소됐으면 취소로 끝낸다", async () => {
  const failingRuntime = {
    hasVideoWebCodecs: () => true,
    loadAacEncoder: async () => ({ registerAacEncoder() {} }),
    loadMedia: async () => {
      throw new Error("chunk load failed");
    },
  };
  const file = largeVideo();
  assert.equal(await compressVideo(file, 60, {}, failingRuntime), file);

  const controller = new AbortController();
  const abortingRuntime = {
    ...failingRuntime,
    loadMedia: async () => {
      controller.abort("다른 영상 선택");
      return fake;
    },
  };
  const error = await compressVideo(file, 60, { signal: controller.signal }, abortingRuntime).catch(
    (caught) => caught,
  );
  assert.equal(error.name, "AbortError");
  assert.equal(error.cause, "다른 영상 선택");
});

test("인코딩 중 취소하면 변환 취소가 실패해도 취소로 끝낸다", async () => {
  let rejectExecute;
  let executing;
  const started = new Promise((resolve) => {
    executing = resolve;
  });
  fake.conversion = () => ({
    execute: () =>
      new Promise((_, reject) => {
        rejectExecute = reject;
        executing();
      }),
    cancel: async () => {
      fake.calls.cancels += 1;
      rejectExecute(new Error("conversion canceled"));
      throw new Error("encoder already closed");
    },
  });
  const controller = new AbortController();
  const result = compressVideo(largeVideo(), 60, { signal: controller.signal });

  await started;
  controller.abort();

  await assert.rejects(result, { name: "AbortError", message: "영상 준비가 취소되었어요." });
  assert.equal(fake.calls.cancels, 1);
});
