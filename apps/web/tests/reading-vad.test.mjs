// reading.session 침묵 감지 — 마이크 샘플을 숫자 하나(RMS)로 줄이는 부분.
import assert from "node:assert/strict";
import { test } from "node:test";

import "./ts-module-loader.mjs";

const { rmsOf } = await import("../src/lib/reading/audio/vad.ts");

test("reading.vad: 샘플의 제곱 평균의 제곱근을 음량으로 돌려준다", () => {
  assert.equal(rmsOf(new Float32Array([0.5, -0.5, 0.5, -0.5])), 0.5);
  assert.equal(rmsOf(new Float32Array([0, 0, 0, 0])), 0);
  assert.equal(Math.round(rmsOf(new Float32Array([0.6, 0.8])) * 1e6) / 1e6, 0.707107);
});

test("reading.vad: 샘플이 하나도 없으면 0으로 나누지 않고 음량 0을 준다", () => {
  assert.equal(rmsOf(new Float32Array(0)), 0);
});

