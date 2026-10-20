// 실제 브라우저에 붙은 최초 웹 UTM 손잡이의 드문 두 갈래. 모듈 안의 후보는 문서 하나에
// 하나라서 web-attribution-browser.test.mjs 의 흐름과 섞지 않고 문서를 따로 연다.
import assert from "node:assert/strict";
import { after, test } from "node:test";

import "./ts-module-loader.mjs";
import { window } from "./dom-setup.mjs";

process.env.NEXT_PUBLIC_API_BASE_URL = "";

window.history.replaceState(null, "", "/?utm_source=instagram");

const { activateWebAttribution, captureInitialWebAttribution, watchWebAttributionSession } =
  await import("../src/lib/analytics/web-attribution.ts");
const { emitSessionEvent } = await import("../src/lib/auth/session-events.ts");
const { clearTokens, setTokens } = await import("../src/lib/auth/token-store.ts");

const originalFetch = globalThis.fetch;
captureInitialWebAttribution(window.location.search);
const unsubscribe = watchWebAttributionSession();

after(() => {
  unsubscribe();
  globalThis.fetch = originalFetch;
  clearTokens();
});

function currentPath() {
  return `${window.location.pathname}${window.location.search}`;
}

test("게스트 토큰은 있지만 게스트 id 를 모르면 보내지 않고 후보와 주소의 UTM 을 폐기한다", async () => {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return new Response(null, { status: 204 });
  };
  setTokens({ access_token: "guest-access", refresh_token: "guest-refresh" });

  assert.equal(await activateWebAttribution("guest-new"), false);

  assert.deepEqual(calls, []);
  assert.equal(currentPath(), "/");
});

test("정적 프리렌더(window 없음) 중의 경계는 저장소와 주소를 건드리지 않는다", () => {
  window.history.replaceState(null, "", "/home?utm_source=naver");
  const saved = globalThis.window;
  delete globalThis.window;
  try {
    emitSessionEvent("guest-ended");
  } finally {
    globalThis.window = saved;
  }

  assert.equal(currentPath(), "/home?utm_source=naver");
});
