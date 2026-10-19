// 음성 합성 워커(worker.ts). 워커 전역(self·navigator)과 네트워크, onnxruntime 을 대역으로 심고
// 메시지를 보내 워커가 돌려주는 답(진행률·불러오기 결과·소리·오류)을 본다. 워커는 모듈 상태를
// 가지므로 테스트는 위에서 아래로 이어진다.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { beforeEach, test } from "node:test";

import "./ts-module-loader.mjs";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "onnxruntime-web") {
      return { url: new URL("./fixtures/reading-supertonic-ort.mjs", import.meta.url).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const ort = await import("./fixtures/reading-supertonic-ort.mjs");

const posted = [];
const waiters = new Set();
globalThis.self = {
  crossOriginIsolated: false,
  postMessage(msg, transfer) {
    posted.push({ msg, transfer });
    for (const check of waiters) check();
  },
};

function setNavigator(nav) {
  Object.defineProperty(globalThis, "navigator", { value: nav, configurable: true, writable: true });
}
setNavigator({ hardwareConcurrency: 8 });

await import("../src/lib/reading/audio/supertonic/worker.ts");

const BASE = "https://huggingface.co/Supertone/supertonic-3/resolve/main";
const MODEL_URL = {
  dp: `${BASE}/onnx/duration_predictor.onnx`,
  textEnc: `${BASE}/onnx/text_encoder.onnx`,
  vectorEst: `${BASE}/onnx/vector_estimator.onnx`,
  vocoder: `${BASE}/onnx/vocoder.onnx`,
};
// 모델마다 1바이트짜리 가짜 가중치. 세션 대역이 이 바이트로 어느 모델인지 가린다.
const MODEL_BYTE = { dp: 1, textEnc: 2, vectorEst: 3, vocoder: 4 };
const CFGS = { ae: { sample_rate: 100, base_chunk_size: 2 }, ttl: { chunk_compress_factor: 2, latent_dim: 3 } };
const STYLE = { style_ttl: { dims: [1, 1, 2], data: [[[0, 0]]] }, style_dp: { dims: [1, 1, 2], data: [[[0, 0]]] } };

let fetched;
let missing;
function serveNetwork() {
  fetched = [];
  missing = new Set();
  globalThis.fetch = async (input) => {
    const url = String(input);
    fetched.push(url);
    if (missing.has(url)) return new Response("없음", { status: 404 });
    const model = Object.entries(MODEL_URL).find(([, u]) => u === url);
    if (model) return new Response(new Uint8Array([MODEL_BYTE[model[0]]]));
    if (url === `${BASE}/onnx/tts.json`) return Response.json(CFGS);
    if (url === `${BASE}/onnx/unicode_indexer.json`) return Response.json(Array.from({ length: 0x3000 }, (_, cp) => cp));
    if (url.startsWith(`${BASE}/voice_styles/`)) return Response.json(STYLE);
    return new Response("없음", { status: 404 });
  };
}

const runs = { vectorEst: 0 };
let active = 0;
let maxActive = 0;
const models = {
  dp: {
    async run(inputs) {
      const text = Array.from(inputs.text_ids.data, (x) => String.fromCodePoint(Number(x))).join("").normalize("NFC");
      if (text.includes("터짐")) throw new Error("길이 예측 실패");
      if (text.includes("문자열")) throw "런타임이 문자열을 던졌다";
      return { duration: { data: [0.5] } };
    },
  },
  textEnc: { run: async () => ({ text_emb: {} }) },
  vectorEst: {
    async run(inputs) {
      runs.vectorEst++;
      return { denoised_latent: { data: inputs.noisy_latent.data } };
    },
  },
  vocoder: {
    async run() {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return { wav_tts: { data: Float32Array.from({ length: 60 }, (_, i) => i / 100) } };
    },
  },
};
const byByte = Object.fromEntries(Object.entries(MODEL_BYTE).map(([k, b]) => [b, models[k]]));

let createFails;
beforeEach(() => {
  serveNetwork();
  ort.created.length = 0;
  createFails = false;
  ort.sessions.factory = (bytes) => {
    if (createFails) throw new Error("세션을 만들지 못했다");
    return byByte[bytes[0]];
  };
});

let nextId = 0;
/** 메시지를 보내고 그 요청의 마지막 답(loaded·audio·error)을 기다린다. 그사이 진행률도 함께 준다. */
function ask(body) {
  const id = ++nextId;
  const done = new Promise((resolve) => {
    const check = () => {
      const mine = posted.filter((p) => p.msg.id === id);
      const last = mine.find((p) => p.msg.type !== "progress");
      if (!last) return;
      waiters.delete(check);
      resolve({ ...last, progress: mine.filter((p) => p.msg.type === "progress").map((p) => p.msg) });
    };
    waiters.add(check);
  });
  self.onmessage({ data: { ...body, id } });
  return done;
}

test("reading.supertonic-worker: 불러오기 전의 합성 요청에는 준비되지 않았다는 오류로 답한다", async () => {
  const { msg } = await ask({ type: "synth", text: "안녕", preset: "F1", speed: 1, steps: 1, gapSec: 0.1 });
  assert.deepEqual(msg, { id: 1, type: "error", message: "음성 엔진이 준비되지 않았다" });
});

test("reading.supertonic-worker: 가중치 하나를 못 받으면 그 주소를 담은 오류로 답하고, wasm 스레드는 격리 없이는 1개다", async () => {
  missing.add(MODEL_URL.vocoder);

  const { msg } = await ask({ type: "load" });

  assert.deepEqual(msg, { id: 2, type: "error", message: `모델을 받지 못했다 (404): ${MODEL_URL.vocoder}` });
  assert.equal(ort.env.wasm.wasmPaths, "/ort/");
  assert.equal(ort.env.wasm.numThreads, 1);
});

test("reading.supertonic-worker: 내려받는 동안 fp32 전체 용량 대비 진행률을 알리고, GPU 확인이 실패하면 wasm 으로 세션을 만든다", async () => {
  self.crossOriginIsolated = true;
  setNavigator({ hardwareConcurrency: 8, gpu: { requestAdapter: async () => Promise.reject(new Error("no gpu")) } });
  createFails = true;

  const { msg, progress } = await ask({ type: "load" });

  assert.deepEqual(msg, { id: 3, type: "error", message: "세션을 만들지 못했다" });
  assert.equal(ort.env.wasm.numThreads, 4);
  assert.deepEqual(ort.created[0].options, { executionProviders: ["wasm"] });
  assert.deepEqual(
    progress.map((p) => [p.loaded, p.total, p.cached]),
    [
      [1, 398_075_273, false],
      [2, 398_075_273, false],
      [3, 398_075_273, false],
      [4, 398_075_273, false],
    ],
  );
  assert.equal(progress[3].ratio, 4 / 398_075_273);
});

test("reading.supertonic-worker: 코어 수를 모르거나 GPU 어댑터가 없으면 wasm 한 스레드로 돈다", async () => {
  setNavigator({ hardwareConcurrency: 0, gpu: { requestAdapter: async () => null } });
  createFails = true;

  await ask({ type: "load" });

  assert.equal(ort.env.wasm.numThreads, 1);
  assert.deepEqual(ort.created[0].options, { executionProviders: ["wasm"] });
});

test("reading.supertonic-worker: GPU 어댑터가 있으면 webgpu 로 네 모델을 불러오고, 데우기가 실패해도 준비됐다고 답한다", async () => {
  self.crossOriginIsolated = false;
  setNavigator({ hardwareConcurrency: 8, gpu: { requestAdapter: async () => ({}) } });
  missing.add(`${BASE}/voice_styles/F1.json`);

  const { msg } = await ask({ type: "load" });

  assert.deepEqual(msg, { id: 5, type: "loaded", backend: "webgpu", variant: "fp32" });
  assert.deepEqual(
    ort.created.map((c) => [c.source[0], c.options.executionProviders[0]]),
    [
      [1, "webgpu"],
      [2, "webgpu"],
      [3, "webgpu"],
      [4, "webgpu"],
    ],
  );
  assert.ok(fetched.includes(`${BASE}/voice_styles/F1.json`), "F1 목소리로 데우기를 시도했다");
});

test("reading.supertonic-worker: 대사를 합성해 길이만큼 자른 소리를 버퍼째 넘기고, 목소리 파일은 한 번만 받는다", async () => {
  const first = await ask({ type: "synth", text: "안녕", preset: "M1", speed: 1, steps: 3, gapSec: 0.1 });

  assert.equal(first.msg.type, "audio");
  assert.equal(first.msg.sampleRate, 100);
  assert.equal(first.msg.duration, 0.5);
  assert.ok(first.msg.samples instanceof Float32Array);
  assert.deepEqual(Array.from(first.msg.samples), Array.from(Float32Array.from({ length: 50 }, (_, i) => i / 100)));
  assert.deepEqual(first.transfer, [first.msg.samples.buffer]);

  runs.vectorEst = 0;
  const second = await ask({ type: "synth", text: "또 안녕", preset: "M1", speed: 2, steps: 2, gapSec: 0.1 });

  assert.equal(second.msg.duration, 0.25);
  assert.equal(second.msg.samples.length, 25);
  assert.equal(runs.vectorEst, 2);
  assert.deepEqual(
    fetched.filter((u) => u.includes("voice_styles")),
    [`${BASE}/voice_styles/M1.json`, `${BASE}/voice_styles/M1.json`],
    "첫 합성에서만 받는다(치수용 한 번 + 내용 한 번)",
  );
});

test("reading.supertonic-worker: 긴 대사는 조각 사이에 요청한 무음을 넣어 이어 붙인다", async () => {
  const long = `${"가".repeat(69)}. ${"나".repeat(69)}.`;

  const { msg } = await ask({ type: "synth", text: long, preset: "F2", speed: 1, steps: 1, gapSec: 0.2 });

  assert.equal(msg.duration, 1.2);
  assert.equal(msg.samples.length, 120);
  assert.deepEqual(Array.from(msg.samples.slice(58, 62)), Array.from(Float32Array.from([0.58, 0.59, 0, 0])));
});

test("reading.supertonic-worker: 요청을 한 줄로 세워 차례로 합성하고, 하나가 실패해도 다음 요청은 답을 받는다", async () => {
  maxActive = 0;

  const answers = await Promise.all([
    ask({ type: "synth", text: "하나", preset: "F1", speed: 1, steps: 1, gapSec: 0.1 }),
    ask({ type: "synth", text: "터짐", preset: "F1", speed: 1, steps: 1, gapSec: 0.1 }),
    ask({ type: "synth", text: "셋", preset: "F1", speed: 1, steps: 1, gapSec: 0.1 }),
  ]);

  assert.deepEqual(
    answers.map((a) => a.msg.type),
    ["audio", "error", "audio"],
  );
  assert.equal(answers[1].msg.message, "길이 예측 실패");
  assert.equal(maxActive, 1);
  assert.deepEqual(
    posted.slice(-3).map((p) => p.msg.id),
    answers.map((a) => a.msg.id),
  );
});

test("reading.supertonic-worker: 런타임이 Error 가 아닌 값을 던져도 그 값을 오류 문구로 답한다", async () => {
  const { msg } = await ask({ type: "synth", text: "문자열", preset: "F1", speed: 1, steps: 1, gapSec: 0.1 });
  assert.equal(msg.type, "error");
  assert.equal(msg.message, "런타임이 문자열을 던졌다");
});
