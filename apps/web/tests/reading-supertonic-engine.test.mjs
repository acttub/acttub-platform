// 음성 엔진의 창구(engine.ts). 워커를 이 파일의 대역으로 바꿔, 워커에 보낸 메시지와 워커 답을 받아
// 부르는 쪽이 얻는 값(불러오기 결과·진행률·합성된 소리·오류)을 본다. 엔진은 모듈 상태를 가지므로
// 테스트는 위에서 아래로 이어진다.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import "./ts-module-loader.mjs";

const workers = [];
globalThis.Worker = class {
  constructor(url, options) {
    this.url = String(url);
    this.options = options;
    this.sent = [];
    workers.push(this);
  }
  postMessage(msg) {
    this.sent.push(msg);
  }
};

const engine = await import("../src/lib/reading/audio/supertonic/engine.ts");

const worker = () => workers[0];
const lastSent = () => worker().sent.at(-1);
const reply = (data) => worker().onmessage({ data });
const flush = () => new Promise((resolve) => setImmediate(resolve));

const HF = "https://huggingface.co";
const FP32_URLS = ["duration_predictor", "text_encoder", "vector_estimator", "vocoder"].map(
  (name) => `${HF}/Supertone/supertonic-3/resolve/main/onnx/${name}.onnx`,
);
const INT8_URLS = ["duration_predictor", "text_encoder", "vector_estimator", "vocoder"].map(
  (name) => `${HF}/csukuangfj2/sherpa-onnx-supertonic-3-tts-int8-2026-05-11/resolve/main/${name}.int8.onnx`,
);

function installCaches(urls) {
  globalThis.caches = {
    async open() {
      return { match: async (url) => (urls.includes(url) ? new Response("w") : undefined) };
    },
  };
}

afterEach(() => {
  delete globalThis.caches;
});

test("reading.supertonic-engine: 불러오기 전에는 워커 없이 fp32 용량과 캐시 여부로 안내를 정한다", async () => {
  assert.equal(engine.currentBackend(), null);
  assert.equal(engine.currentVariant(), null);
  assert.equal(await engine.downloadSize(), 398_075_273);
  assert.equal(await engine.hasCachedModels(), false);

  installCaches(FP32_URLS.slice(0, 3));
  assert.equal(await engine.hasCachedModels(), false);
  installCaches(FP32_URLS);
  assert.equal(await engine.hasCachedModels(), true);

  assert.equal(workers.length, 0);
});

test("reading.supertonic-engine: 불러오기가 실패하면 오류를 넘기고, 다시 부르면 새로 시도해 결과를 기억한다", async () => {
  const progress = [];
  const first = engine.load((p) => progress.push(p));

  assert.equal(engine.load(), first, "진행 중인 불러오기를 함께 쓴다");
  assert.equal(workers.length, 1);
  assert.ok(worker().url.endsWith("/src/lib/reading/audio/supertonic/worker.ts"));
  assert.deepEqual(worker().options, { type: "module" });
  assert.deepEqual(worker().sent, [{ type: "load", id: 1 }]);

  reply({ id: 1, type: "progress", ratio: 0.5, loaded: 5, total: 10, cached: false });
  reply({ id: 99, type: "error", message: "모르는 요청" });
  reply({ id: 1, type: "error", message: "가중치를 받지 못했다" });

  await assert.rejects(first, { message: "가중치를 받지 못했다" });
  assert.deepEqual(progress, [{ ratio: 0.5, loaded: 5, total: 10, cached: false }]);
  assert.equal(engine.currentBackend(), null);

  const second = engine.load();
  assert.deepEqual(lastSent(), { type: "load", id: 2 });
  reply({ id: 2, type: "progress", ratio: 1, loaded: 10, total: 10, cached: true });
  reply({ id: 2, type: "loaded", backend: "webgpu", variant: "int8" });

  assert.deepEqual(await second, { backend: "webgpu", variant: "int8" });
  assert.equal(engine.currentBackend(), "webgpu");
  assert.equal(engine.currentVariant(), "int8");

  assert.deepEqual(await engine.load(), { backend: "webgpu", variant: "int8" });
  assert.equal(worker().sent.length, 2);
  assert.equal(workers.length, 1);
});

test("reading.supertonic-engine: 불러온 뒤에는 워커가 고른 가중치로 용량과 캐시 여부를 답한다", async () => {
  assert.equal(await engine.downloadSize(), 144_508_203);
  installCaches(FP32_URLS);
  assert.equal(await engine.hasCachedModels(), false);
  installCaches(INT8_URLS);
  assert.equal(await engine.hasCachedModels(), true);
});

test("reading.supertonic-engine: 대사를 기본 속도·단계·무음으로 합성하고, 같은 대사는 다시 만들지 않는다", async () => {
  const made = engine.synthesize("안녕", "F1");
  await flush();
  assert.deepEqual(lastSent(), { type: "synth", text: "안녕", preset: "F1", speed: 1, steps: 8, gapSec: 0.1, id: 3 });

  const samples = new Float32Array([0.1, -0.1]);
  reply({ id: 3, type: "audio", samples, sampleRate: 24000, duration: 0.5 });
  assert.deepEqual(await made, { samples, sampleRate: 24000, duration: 0.5 });

  assert.equal(engine.synthesize("안녕", "F1"), made);
  await flush();
  assert.equal(worker().sent.length, 3);

  engine.synthesize("안녕", "F1", { speed: 1.2, steps: 4, gapSec: 0 });
  await flush();
  assert.deepEqual(lastSent(), { type: "synth", text: "안녕", preset: "F1", speed: 1.2, steps: 4, gapSec: 0, id: 4 });
});

test("reading.supertonic-engine: 합성이 실패한 대사는 기억하지 않아 다시 청하면 새로 만든다", async () => {
  const failed = engine.synthesize("깨짐", "M1");
  await flush();
  reply({ id: 5, type: "error", message: "추론 실패" });
  await assert.rejects(failed, { message: "추론 실패" });

  engine.synthesize("깨짐", "M1");
  await flush();
  assert.deepEqual(lastSent(), { type: "synth", text: "깨짐", preset: "M1", speed: 1, steps: 8, gapSec: 0.1, id: 6 });
});

test("reading.supertonic-engine: 만들어 둔 소리는 최근 24개만 남기고, 다시 쓴 것은 최근 것으로 올린다", async () => {
  // 지금 남은 것: 안녕(기본), 안녕(빠르게), 깨짐. 기본 쪽을 다시 써서 맨 뒤로 올린다.
  engine.synthesize("안녕", "F1");
  for (let i = 0; i < 22; i++) engine.synthesize(`줄 ${i}`, "M2");
  await flush();
  const before = worker().sent.length;

  engine.synthesize("안녕", "F1");
  engine.synthesize("깨짐", "M1");
  await flush();
  assert.equal(worker().sent.length, before, "24개 안에 든 것은 다시 보내지 않는다");

  engine.synthesize("안녕", "F1", { speed: 1.2, steps: 4, gapSec: 0 });
  await flush();
  assert.deepEqual(
    { ...lastSent(), id: 0 },
    { type: "synth", text: "안녕", preset: "F1", speed: 1.2, steps: 4, gapSec: 0, id: 0 },
    "가장 오래 안 쓴 것이 밀려나 다시 만든다",
  );
});
