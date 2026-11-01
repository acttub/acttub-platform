// /reading/check — 이 기기에서 음성 모델이 쓸 만한지 재 보는 화면. 엔진이 알려 준 값과 걸린 시간으로 줄을 채우고,
// 두 번째 합성의 속도(RTF)로 쓸 만한지를 말한다.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { afterEach, beforeEach, test } from "node:test";

import "./ts-module-loader.mjs";
import { react } from "./mount-probe.mjs";

const fake = new URL("./fixtures/reading-device-check-engine.mjs", import.meta.url).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/lib/reading/audio/supertonic/engine" || specifier === "@/lib/reading/audio/supertonic/play") {
      return { url: fake, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const { engine } = await import("./fixtures/reading-device-check-engine.mjs");
const { act, cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const { default: MobileCheck } = await import("../src/features/reading/device-check.tsx");

const realNow = performance.now;
function clock(loadMs, genMs) {
  Object.assign(engine, { now: 0, loadMs, genMs });
  engine.synthesized.length = 0;
  performance.now = () => engine.now;
}

function setNavigator({ gpu, deviceMemory }) {
  Object.defineProperty(globalThis.navigator, "gpu", { configurable: true, value: gpu });
  Object.defineProperty(globalThis.navigator, "deviceMemory", { configurable: true, value: deviceMemory });
}

async function runCheck() {
  render(react.createElement(MobileCheck));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "검사 시작" }));
  });
}

beforeEach(() => {
  Object.assign(engine, { size: 380 * 1024 * 1024, cached: false, backend: "webgpu", variant: "fp32", duration: 2.5, loadError: null, onLoad: null, loadGate: null, unlocked: 0 });
  engine.synthesized.length = 0;
  engine.played.length = 0;
});

afterEach(() => {
  cleanup();
  performance.now = realNow;
  delete globalThis.navigator.gpu;
  delete globalThis.navigator.deviceMemory;
});

test("reading.cast: 검사는 GPU·메모리·용량·준비 시간·쓰는 방식·만드는 속도를 보이고 소리를 낸 뒤 확인 문구를 보인다", async () => {
  setNavigator({ gpu: { requestAdapter: async () => ({}) }, deviceMemory: 8 });
  clock(12_000, 1_000);
  await runCheck();

  const text = screen.getByRole("main").textContent;
  for (const piece of ["WebGPU있음", "기기 메모리약 8GB", "받아야 할 용량380MB", "준비 시간12.0초", "쓰는 방식webgpu + fp32", "만드는 속도2.5초 대사에 1.0초 (RTF 0.40)", "쓸 만한가넉넉하다"]) {
    assert.equal(text.includes(piece), true, piece);
  }
  screen.getByText("소리가 났고 끊기지 않았다면 이 기기에서 쓸 수 있어요.");
  assert.deepEqual(engine.synthesized.map((s) => s.preset), ["F1", "M1"]);
  assert.deepEqual(engine.synthesized[1].options, { gapSec: 0.1 });
  assert.deepEqual(engine.played, [2.5]);
  assert.equal(engine.unlocked, 1);
  assert.equal(screen.getByRole("button", { name: "검사 시작" }).disabled, false);
});

test("reading.cast: 속도가 느릴수록 쓸 만하다·빠듯하다·기다림이 생긴다로 말한다", async () => {
  for (const [genMs, verdictCopy] of [[1_500, "쓸 만하다"], [2_500, "빠듯하다"], [5_000, "느려서 기다림이 생긴다"]]) {
    clock(1_000, genMs);
    await runCheck();
    assert.equal(screen.getByRole("main").textContent.includes(`쓸 만한가${verdictCopy}`), true, verdictCopy);
    cleanup();
  }
});

test("reading.cast: GPU 가 없거나 확인이 실패하면 느린 길로 간다고 보이고, 이미 받아 둔 모델은 그렇게 알린다", async () => {
  setNavigator({ gpu: { requestAdapter: async () => { throw new Error("blocked"); } } });
  engine.cached = true;
  clock(1_000, 500);
  await runCheck();

  const text = screen.getByRole("main").textContent;
  assert.equal(text.includes("WebGPU없음 — 느린 길로 감"), true);
  assert.equal(text.includes("받아야 할 용량380MB (이미 받아 둠)"), true);
  assert.equal(text.includes("기기 메모리"), false);
});

test("reading.cast: 받는 동안 받은 양을 보이고 버튼은 재는 중으로 잠긴다", async () => {
  let release;
  engine.loadGate = new Promise((r) => {
    release = r;
  });
  engine.onLoad = (onProgress) => onProgress({ ratio: 0.5, loaded: 190 * 1024 * 1024, total: 380 * 1024 * 1024, cached: false });
  clock(1_000, 500);
  await runCheck();

  screen.getByText("190MB / 380MB");
  assert.equal(screen.getByRole("button", { name: "재는 중…" }).disabled, true);

  await act(async () => release());
  assert.equal(screen.queryByText("190MB / 380MB"), null);
  assert.equal(screen.getByRole("button", { name: "검사 시작" }).disabled, false);
});

test("reading.cast: 캐시에서 받는 중이면 받은 양을 따로 보이지 않는다", async () => {
  let release;
  engine.loadGate = new Promise((r) => {
    release = r;
  });
  engine.onLoad = (onProgress) => onProgress({ ratio: 1, loaded: 10, total: 10, cached: true });
  clock(1_000, 500);
  await runCheck();

  assert.equal(screen.queryByText(/MB \/ /), null);
  await act(async () => release());
});

test("reading.cast: 모델을 준비하지 못하면 실패 줄에 이유를 보이고 확인 문구는 없다", async () => {
  engine.loadError = new Error("저장 공간이 모자라요");
  await runCheck();
  assert.equal(screen.getByRole("main").textContent.includes("실패저장 공간이 모자라요"), true);
  assert.equal(screen.queryByText("소리가 났고 끊기지 않았다면 이 기기에서 쓸 수 있어요."), null);

  cleanup();
  engine.loadError = "문자열 오류";
  await runCheck();
  assert.equal(screen.getByRole("main").textContent.includes("실패문자열 오류"), true);
});
