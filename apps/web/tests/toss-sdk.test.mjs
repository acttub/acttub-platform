// 토스 결제 SDK 스크립트 불러오기. jsdom 은 외부 스크립트를 내려받지 않으므로, 심긴 <script> 에 load·error 를
// 직접 보내 브라우저가 받은 결과를 흉내 낸다. 15초 시한은 window.setTimeout 대역으로 손으로 흘린다.
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import "./ts-module-loader.mjs";

const { window } = await import("./dom-setup.mjs");
const { loadTossSdk } = await import("../src/features/pg-review/toss-sdk.ts");
const SDK_URL = "https://js.tosspayments.com/v2/standard";
const factory = () => ({ payment: () => ({ requestBillingAuth: async () => {} }) });

let timers;
beforeEach(() => {
  timers = new Map();
  let nextId = 1;
  window.setTimeout = (callback, delay) => {
    const id = nextId++;
    timers.set(id, { callback, delay });
    return id;
  };
  window.clearTimeout = (id) => {
    timers.delete(id);
  };
});

afterEach(() => {
  delete window.TossPayments;
  for (const script of window.document.head.querySelectorAll("script")) script.remove();
});

test("window 가 없는 서버 렌더에서는 스크립트를 심지 않고 거절한다", async () => {
  delete globalThis.window;
  try {
    await assert.rejects(loadTossSdk(), { message: "no window" });
  } finally {
    globalThis.window = window;
  }
  assert.equal(window.document.head.querySelectorAll("script").length, 0);
});

const scripts = () =>
  [...window.document.head.querySelectorAll("script")].map((node) => ({ src: node.src, async: node.async }));
const sdkScript = () => window.document.head.querySelector(`script[src="${SDK_URL}"]`);

test("이미 불러온 SDK 가 있으면 스크립트를 더 심지 않고 그것을 쓴다", async () => {
  window.TossPayments = factory;
  assert.equal(await loadTossSdk(), factory);
  assert.deepEqual(scripts(), []);
});

test("스크립트를 못 받으면 거절하고 스크립트를 걷는다", async () => {
  const attempt = loadTossSdk();
  sdkScript().dispatchEvent(new window.Event("error"));
  await assert.rejects(attempt, { message: "sdk_load_failed" });
  assert.deepEqual(scripts(), []);
  assert.equal(timers.size, 0);
});

test("15초 안에 끝나지 않으면 거절하고 스크립트를 걷는다", async () => {
  const attempt = loadTossSdk();
  for (const { callback } of timers.values()) callback();
  await assert.rejects(attempt, { message: "sdk_timeout" });
  assert.deepEqual(scripts(), []);
});

// 성공한 불러오기는 모듈에 남으므로 이 테스트가 마지막이다.
test("받았는데 SDK 가 없으면 거절하고, 다음 호출들은 새 스크립트 하나를 함께 기다려 같은 SDK 를 받는다", async () => {
  const attempt = loadTossSdk();
  const stale = sdkScript();
  stale.dispatchEvent(new window.Event("load"));
  await assert.rejects(attempt, { message: "sdk_missing" });
  assert.deepEqual(scripts(), []);
  assert.equal(timers.size, 0);

  const first = loadTossSdk();
  const second = loadTossSdk();
  assert.deepEqual(scripts(), [{ src: SDK_URL, async: true }]);
  assert.notEqual(sdkScript(), stale);
  assert.deepEqual([...timers.values()].map((timer) => timer.delay), [15000]);

  window.TossPayments = factory;
  sdkScript().dispatchEvent(new window.Event("load"));
  assert.deepEqual(await Promise.all([first, second]), [factory, factory]);
  assert.equal(timers.size, 0, "받은 뒤에는 시한을 거둔다");
});
