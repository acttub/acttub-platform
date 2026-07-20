import assert from "node:assert/strict";
import { test } from "node:test";

import "./ts-module-loader.mjs";

const {
  AUDIO_BITRATE,
  MAX_FRAME_RATE,
  MAX_LONG_EDGE,
  MAX_VIDEO_BITRATE,
  SKIP_COMPRESSION_BYTES,
  TARGET_OUTPUT_BYTES,
  computeFrameRate,
  computeOutputDimensions,
  computeVideoBitrate,
  shouldSkipCompression,
} = await import("../src/lib/media/compression-plan.ts");

test("50MB 이하는 압축을 건너뛰고 초과 파일만 압축한다", () => {
  assert.equal(shouldSkipCompression(SKIP_COMPRESSION_BYTES), true);
  assert.equal(shouldSkipCompression(SKIP_COMPRESSION_BYTES + 1), false);
});

test("짧은 영상의 비디오 비트레이트는 2Mbps를 넘지 않는다", () => {
  assert.equal(computeVideoBitrate(60), MAX_VIDEO_BITRATE);
});

test("5분 영상은 50MB 목표와 AAC 128kbps를 반영한 비트레이트를 쓴다", () => {
  const expected =
    Math.floor((0.95 * TARGET_OUTPUT_BYTES * 8) / 300) - AUDIO_BITRATE;

  assert.equal(computeVideoBitrate(300), expected);
  assert.equal(expected, 1_200_196);
});

test("가로 영상은 긴 변만 1280px로 줄이고 업스케일하지 않는다", () => {
  assert.deepEqual(computeOutputDimensions(1920, 1080), {
    width: MAX_LONG_EDGE,
  });
  assert.deepEqual(computeOutputDimensions(1280, 720), {});
  assert.deepEqual(computeOutputDimensions(640, 480), {});
});

test("세로 영상은 높이만 1280px로 줄여 종횡비 계산을 mediabunny에 맡긴다", () => {
  assert.deepEqual(computeOutputDimensions(1080, 1920), {
    height: MAX_LONG_EDGE,
  });
});

test("평균 fps가 30을 초과할 때만 30fps 제한을 지정한다", () => {
  assert.equal(computeFrameRate(60), MAX_FRAME_RATE);
  assert.equal(computeFrameRate(30.001), MAX_FRAME_RATE);
  assert.equal(computeFrameRate(30), undefined);
  assert.equal(computeFrameRate(29.97), undefined);
});
