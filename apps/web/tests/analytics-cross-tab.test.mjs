// 계측이 서버에 다시 묻는 때는 셋뿐이다(ANALYTICS.md §1(1)) — 앱을 시작할 때 한 번, 탭이 다시
// 보일 때, 동의 제출 직후. 다른 탭에서 일어난 일은 storage 이벤트로만 오는데, 그것은 묻는 때가
// 아니다: 게스트의 끝·시작이면 묻지 않고 끄고, 같은 게스트의 토큰 회전과 무관한 키의 쓰기는
// 지나친다. 루트에 놓이는 <Analytics /> 를 실제로 띄워 그 배선을 본다.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { after, afterEach, before, beforeEach, test } from "node:test";

import "./ts-module-loader.mjs";
import { mountProbe as mount, react, window } from "./mount-probe.mjs";

process.env.NEXT_PUBLIC_API_BASE_URL = "";
process.env.NEXT_PUBLIC_AMPLITUDE_API_KEY = "test-amplitude-key";

// SDK 의 네트워크가 아니라 우리가 켜고 끄는지만 본다(analytics-amplitude.test.mjs 와 같은 목).
const amplitudeMockUrl = `data:text/javascript,${encodeURIComponent(`
const calls = globalThis.__amplitudeCalls;
export const init = (...args) => calls.push(["init", ...args]);
export const add = (...args) => calls.push(["add", ...args]);
export const track = (...args) => calls.push(["track", ...args]);
export const setUserId = (...args) => calls.push(["setUserId", ...args]);
export const reset = (...args) => calls.push(["reset", ...args]);
export const setOptOut = (...args) => calls.push(["setOptOut", ...args]);
`)}`;
const replayMockUrl = `data:text/javascript,${encodeURIComponent(`
export const sessionReplayPlugin = () => ({ name: "session-replay" });
`)}`;
// 앱 라우터 밖에서는 usePathname 이 돌지 않는다. 화면 하나에 머무는 것으로 둔다.
const navigationMockUrl = `data:text/javascript,${encodeURIComponent(`
export const usePathname = () => "/home";
`)}`;

globalThis.__amplitudeCalls = [];
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@amplitude/analytics-browser") {
      return { url: amplitudeMockUrl, shortCircuit: true };
    }
    if (specifier === "@amplitude/plugin-session-replay-browser") {
      return { url: replayMockUrl, shortCircuit: true };
    }
    if (specifier === "next/navigation") {
      return { url: navigationMockUrl, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const REFRESH_KEY = "acttub.guest.refresh_token";

let Analytics;
let analyticsConsentGate;
let clearTokens;
let setTokens;

before(async () => {
  ({ Analytics, analyticsConsentGate } = await import(
    "../src/features/analytics/analytics.tsx"
  ));
  ({ clearTokens, setTokens } = await import("../src/lib/auth/token-store.ts"));
});

const originalFetch = globalThis.fetch;
let entryCalls;
let probe;

function serveGrantedEntry() {
  entryCalls = [];
  globalThis.fetch = async (url, options = {}) => {
    entryCalls.push(`${options.method ?? "GET"} ${String(url)}`);
    return new Response(
      JSON.stringify({
        entry_status: "allowed",
        documents: [{ type: "privacy", current_decision: "granted" }],
        undecided_documents: [],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
}

function startGuest(id = "guest-1") {
  setTokens(
    { access_token: `${id}-access`, refresh_token: `${id}-refresh` },
    { id, email: null, status: "active" },
  );
}

/**
 * 다른 탭의 localStorage 쓰기가 이 탭에 도착한 것. 저장소는 탭들이 함께 쓰므로 값부터 바뀌어
 * 있고, 그 뒤에 storage 이벤트가 온다(이 탭의 쓰기는 이벤트를 내지 않는다).
 */
function fromAnotherTab(key, oldValue, newValue) {
  if (key === null) window.localStorage.clear();
  else if (newValue === null) window.localStorage.removeItem(key);
  else window.localStorage.setItem(key, newValue);
  window.dispatchEvent(
    new window.StorageEvent("storage", { key, oldValue, newValue }),
  );
}

/** jsdom 의 문서는 보이지 않는 채로 시작한다. 탭이 다시 보이는 순간을 만든다. */
function becomeVisible() {
  Object.defineProperty(window.document, "visibilityState", {
    configurable: true,
    get: () => "visible",
  });
  window.document.dispatchEvent(new window.Event("visibilitychange"));
}

/** 마지막으로 SDK 에 건 opt-out. 켜져 있으면 false(또는 건 적 없음), 꺼졌으면 true. */
function optedOut() {
  const last = globalThis.__amplitudeCalls.findLast(([name]) => name === "setOptOut");
  return last ? last[1] : false;
}

/** 계측이 켜진 채로 <Analytics /> 를 띄우고, 그 뒤의 조회만 세도록 기록을 비운다. */
async function mountMeasuring() {
  probe = mount(Analytics);
  await react.act(async () => {
    await analyticsConsentGate.check();
  });
  assert.equal(optedOut(), false);
  entryCalls.length = 0;
}

beforeEach(() => {
  window.localStorage.clear();
  clearTokens();
  startGuest();
  serveGrantedEntry();
});

afterEach(() => {
  probe?.unmount();
  probe = undefined;
  analyticsConsentGate.suspend();
  globalThis.fetch = originalFetch;
  clearTokens();
  window.localStorage.clear();
});

after(() => {
  delete globalThis.__amplitudeCalls;
});

test("계측 I-6: 다른 탭이 무관한 키를 써도 서버에 다시 묻지 않고 계측도 끊기지 않는다", async () => {
  await mountMeasuring();

  await react.act(async () => {
    // 다른 탭의 Amplitude SDK 가 보내지 못한 이벤트를 쌓는 키. 이벤트마다 쓰인다.
    fromAnotherTab("AMP_unsent_test", null, "[]");
    fromAnotherTab("acttub.guest.age_confirmed", null, "1");
  });

  assert.deepEqual(entryCalls, []);
  assert.equal(optedOut(), false);
});

test("계측 I-6: 다른 탭에서 같은 게스트의 토큰이 회전해도 묻지도 끄지도 않는다", async () => {
  await mountMeasuring();

  await react.act(async () => {
    fromAnotherTab(REFRESH_KEY, "guest-1-refresh", "guest-1-refresh-2");
  });

  assert.deepEqual(entryCalls, []);
  assert.equal(optedOut(), false);
});

test("계측 I-6: 다른 탭에서 게스트가 끝나면 서버에 묻지 않고 즉시 끈다", async () => {
  await mountMeasuring();

  await react.act(async () => {
    fromAnotherTab(REFRESH_KEY, "guest-1-refresh", null);
  });

  assert.equal(optedOut(), true);
  assert.deepEqual(entryCalls, []);
});

test("계측 I-6: 다른 탭에서 새 게스트가 시작되면 앞 게스트의 켜짐을 물려주지 않고 묻지도 않는다", async () => {
  await mountMeasuring();

  await react.act(async () => {
    fromAnotherTab(REFRESH_KEY, null, "guest-2-refresh");
  });

  assert.equal(optedOut(), true);
  assert.deepEqual(entryCalls, []);
});

test("계측 I-6: 다른 탭이 저장소를 통째로 비우면(key 없음) 끈다", async () => {
  await mountMeasuring();

  await react.act(async () => {
    fromAnotherTab(null, null, null);
  });

  assert.equal(optedOut(), true);
  assert.deepEqual(entryCalls, []);
});

test("계측 I-6: 탭이 다시 보일 때는 서버에 다시 묻는다 — 묻는 때 셋 가운데 하나", async () => {
  await mountMeasuring();

  await react.act(async () => {
    becomeVisible();
  });

  assert.deepEqual(entryCalls, ["GET /v2/consents/entry"]);
  assert.equal(optedOut(), false);
});

test("계측 I-6: 화면을 떠나면 다른 탭의 변화를 더 듣지 않는다", async () => {
  await mountMeasuring();
  probe.unmount();
  probe = undefined;

  fromAnotherTab(REFRESH_KEY, "guest-1-refresh", null);

  assert.equal(optedOut(), false);
});
