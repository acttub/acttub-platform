// 실제 브라우저에 붙은 최초 웹 UTM 손잡이(ANALYTICS.md 「운영 유입 비교용 최초 웹 UTM」). 주소,
// sessionStorage, 이 탭의 세션 이벤트, 다른 탭의 storage 이벤트를 그대로 쓴다.
//
// 모듈 안의 후보는 문서 하나에 하나다(처음 연 주소를 한 번만 읽는다). 이 파일은 문서 하나를
// 열어 둔 채 테스트를 차례로 이어 간다 — 광고 링크로 들어와 새 게스트가 동의하고 저장을 끝낸
// 뒤, 계정 경계마다 주소의 UTM 을 지우는지 본다. 쿼리를 붙여 모듈을 다시 불러오면 커버리지의
// 분기 번호가 인스턴스마다 달라 조건 수가 부풀므로 그렇게 하지 않는다.
import assert from "node:assert/strict";
import { after, test } from "node:test";

import "./ts-module-loader.mjs";
import { window } from "./dom-setup.mjs";

process.env.NEXT_PUBLIC_API_BASE_URL = "";

const PENDING_KEY = "acttub.web_attribution.pending";
const REFRESH_KEY = "acttub.guest.refresh_token";

window.history.replaceState(
  null,
  "",
  "/?utm_source=instagram&utm_medium=paid_social&utm_id=meta_42&session=abc#top",
);

const {
  activateWebAttribution,
  captureInitialWebAttribution,
  pauseWebAttribution,
  preservePendingWebAttribution,
  watchWebAttributionSession,
} = await import("../src/lib/analytics/web-attribution.ts");
const { emitSessionEvent } = await import("../src/lib/auth/session-events.ts");
const { clearTokens, setTokens } = await import("../src/lib/auth/token-store.ts");

const originalFetch = globalThis.fetch;
const sessionStorageDescriptor = Object.getOwnPropertyDescriptor(window, "sessionStorage");

// 루트의 <Analytics /> 가 하는 것과 같다. 처음 연 주소를 읽고 경계를 듣는다.
captureInitialWebAttribution(window.location.search);
let unsubscribe = watchWebAttributionSession();

after(() => {
  unsubscribe();
  globalThis.fetch = originalFetch;
  Object.defineProperty(window, "sessionStorage", sessionStorageDescriptor);
  clearTokens();
});

/** PUT /v2/me/web-attribution 을 받는다. `hang` 이면 취소될 때까지 답하지 않는다. */
function serveAttribution({ hang = false } = {}) {
  const calls = [];
  globalThis.fetch = (url, options = {}) => {
    calls.push({
      route: `${options.method} ${String(url)}`,
      body: JSON.parse(options.body),
      authorization: new Headers(options.headers).get("Authorization"),
    });
    if (!hang) return Promise.resolve(new Response(null, { status: 204 }));
    return new Promise((_resolve, reject) => {
      options.signal?.addEventListener("abort", () =>
        reject(new DOMException("aborted", "AbortError")),
      );
    });
  };
  return calls;
}

function currentPath() {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function fromAnotherTab(key, oldValue, newValue) {
  window.dispatchEvent(new window.StorageEvent("storage", { key, oldValue, newValue }));
}

/** 계정 경계를 확인하려고 주소에 다시 광고 UTM 을 단다. */
function tagUrl() {
  window.history.replaceState(null, "", "/home?utm_source=naver&session=abc");
}

test("동의 전에는 안전 UTM 을 내부 이동에만 싣고 저장소나 서버를 쓰지 않는다", () => {
  const calls = serveAttribution();

  assert.equal(
    preservePendingWebAttribution("/practice/new"),
    "/practice/new?utm_source=instagram&utm_medium=paid_social&utm_id=meta_42",
  );
  assert.equal(window.sessionStorage.getItem(PENDING_KEY), null);
  assert.deepEqual(calls, []);
});

test("동의 재확인으로 멈추면 진행 중 PUT 을 취소하고, 이 탭의 pending 과 주소의 UTM 을 남겨 둔다", async () => {
  const calls = serveAttribution({ hang: true });
  setTokens(
    { access_token: "guest-new-access", refresh_token: "guest-new-refresh" },
    { id: "guest-new", email: null, status: "active" },
  );
  emitSessionEvent("guest-started");

  const first = activateWebAttribution("guest-new");
  pauseWebAttribution();

  assert.equal(await first, false);
  assert.deepEqual(calls, [
    {
      route: "PUT /v2/me/web-attribution",
      body: { channel: "instagram", medium: "paid_social" },
      authorization: "Bearer guest-new-access",
    },
  ]);
  assert.deepEqual(JSON.parse(window.sessionStorage.getItem(PENDING_KEY)), {
    userId: "guest-new",
    request: { channel: "instagram", medium: "paid_social" },
  });
  assert.equal(
    currentPath(),
    "/?utm_source=instagram&utm_medium=paid_social&utm_id=meta_42&session=abc#top",
  );
});

test("sessionStorage 접근이 막혀도 다시 켜면 메모리 후보로 한 번 저장하고 주소에서 UTM 만 지운다", async () => {
  const calls = serveAttribution();
  Object.defineProperty(window, "sessionStorage", {
    configurable: true,
    get() {
      throw new Error("SecurityError");
    },
  });
  try {
    assert.equal(await activateWebAttribution("guest-new"), true);
  } finally {
    Object.defineProperty(window, "sessionStorage", sessionStorageDescriptor);
  }

  assert.deepEqual(calls.map((call) => call.body), [{ channel: "instagram", medium: "paid_social" }]);
  assert.equal(currentPath(), "/?session=abc#top");
  assert.equal(preservePendingWebAttribution("/home"), "/home");
  // 끝난 뒤에는 다시 보내지 않는다.
  assert.equal(await activateWebAttribution("guest-new"), false);
  assert.equal(calls.length, 1);
});

test("같은 게스트의 토큰 회전과 무관한 키의 쓰기는 경계가 아니라 주소를 건드리지 않는다", () => {
  tagUrl();

  fromAnotherTab(REFRESH_KEY, "refresh-1", "refresh-2");
  fromAnotherTab("ph_phc_project_posthog", null, "{}");

  assert.equal(currentPath(), "/home?utm_source=naver&session=abc");
});

for (const [label, boundary] of [
  // 저장을 끝낸 뒤의 새 시작은 다른 계정의 시작이다. 이 뒤로는 후보가 폐기된 채다.
  ["저장을 끝낸 뒤 이 탭에서 새 게스트가 시작되면", () => emitSessionEvent("guest-started")],
  ["이 탭의 게스트가 끝나면", () => emitSessionEvent("guest-ended")],
  [
    "게스트 시작을 알렸는데 저장된 게스트가 없으면",
    () => {
      clearTokens();
      emitSessionEvent("guest-started");
    },
  ],
  ["다른 탭이 저장소를 통째로 비우면", () => fromAnotherTab(null, null, null)],
  ["다른 탭에서 게스트가 끝나면", () => fromAnotherTab(REFRESH_KEY, "old-refresh", null)],
  ["다른 탭에서 게스트가 시작되면", () => fromAnotherTab(REFRESH_KEY, null, "other-refresh")],
]) {
  test(`${label} 계정 경계로 보고 주소의 UTM 을 지운다`, () => {
    tagUrl();

    boundary();

    assert.equal(currentPath(), "/home?session=abc");
  });
}

test("UTM 이 없는 주소에서는 경계가 와도 주소를 다시 쓰지 않는다", () => {
  window.history.replaceState(null, "", "/home?session=abc");
  const replaced = [];
  window.history.replaceState = (...args) => replaced.push(args[2]);
  try {
    emitSessionEvent("guest-ended");
  } finally {
    delete window.history.replaceState;
  }

  assert.deepEqual(replaced, []);
});

test("감시를 거두면 그 뒤의 게스트 끝과 다른 탭의 변화에 반응하지 않는다", () => {
  unsubscribe();
  unsubscribe = () => undefined;
  tagUrl();

  emitSessionEvent("guest-ended");
  fromAnotherTab(null, null, null);

  assert.equal(currentPath(), "/home?utm_source=naver&session=abc");
});
