// 게스트 만들기와 토큰 갱신을 탭 사이에서 하나로 묶는 Web Locks 갈래(account.guest).
// 공용 클라이언트를 거친 기본 흐름은 v2-guest-session·v2-refresh 가 본다.
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import "./ts-module-loader.mjs";

process.env.NEXT_PUBLIC_API_BASE_URL = "";

const { ensureGuestSession } = await import("../src/lib/auth/guest-session.ts");
const { refreshAccessToken } = await import("../src/lib/auth/refresh.ts");
const { onSessionEvent } = await import("../src/lib/auth/session-events.ts");
const { clearTokens, getAccessToken, getRefreshToken, setTokens } = await import("../src/lib/auth/token-store.ts");

const originalFetch = globalThis.fetch;
const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");

function setNavigator(value) {
  Object.defineProperty(globalThis, "navigator", { value, configurable: true, writable: true });
}

let events;
let stopListening;
beforeEach(() => {
  clearTokens();
  events = [];
  stopListening = onSessionEvent((event) => events.push(event));
});

afterEach(() => {
  stopListening();
  globalThis.fetch = originalFetch;
  Object.defineProperty(globalThis, "navigator", navigatorDescriptor);
  clearTokens();
});

function recordFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ route: `${options.method} ${String(url)}`, body: options.body });
    return handler(calls.length);
  };
  return calls;
}

const json = (payload, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });

const guest = (suffix) => ({
  access_token: `guest-access-${suffix}`,
  refresh_token: `guest-refresh-${suffix}`,
  token_type: "bearer",
  expires_in: 1800,
  user: { id: `guest-${suffix}`, email: null, status: "active" },
  account_type: "guest",
});

/** 락을 얻기 전에 다른 탭의 일이 먼저 끝나는 Web Locks. */
function locksWhereOtherTabWinsFirst(otherTab) {
  const requested = [];
  return {
    requested,
    locks: {
      request: async (name, callback) => {
        requested.push(name);
        otherTab();
        return callback();
      },
    },
  };
}

for (const [label, value] of [
  ["navigator 가 없는", undefined],
  ["Web Locks 가 없는", {}],
]) {
  test(`${label} 브라우저에서도 게스트를 하나 만들어 저장하고 시작을 알린다`, async () => {
    setNavigator(value);
    const calls = recordFetch(() => json(guest("1"), 201));

    const access = await ensureGuestSession();

    assert.equal(access, "guest-access-1");
    assert.equal(getRefreshToken(), "guest-refresh-1");
    assert.deepEqual(calls.map((c) => c.route), ["POST /v2/auth/guest"]);
    assert.deepEqual(events, ["guest-started"]);
  });

  test(`${label} 브라우저에서도 갱신한 토큰을 저장해 돌려준다`, async () => {
    setNavigator(value);
    setTokens({ access_token: "old-access", refresh_token: "old-refresh" });
    const calls = recordFetch(() => json({ access_token: "new-access", refresh_token: "new-refresh" }));

    const access = await refreshAccessToken("old-access");

    assert.equal(access, "new-access");
    assert.equal(getRefreshToken(), "new-refresh");
    assert.deepEqual(calls, [
      { route: "POST /v2/auth/refresh", body: JSON.stringify({ refresh_token: "old-refresh" }) },
    ]);
  });
}

test("락을 기다리는 사이 다른 탭이 게스트를 만들었으면 서버에 가지 않고 그 게스트를 같이 쓴다", async () => {
  const { locks, requested } = locksWhereOtherTabWinsFirst(() =>
    setTokens({ access_token: "other-tab-access", refresh_token: "other-tab-refresh" }),
  );
  setNavigator({ locks });
  const calls = recordFetch(() => json(guest("mine"), 201));

  const access = await ensureGuestSession();

  assert.equal(access, "other-tab-access");
  assert.deepEqual(requested, ["acttub.guest"]);
  assert.deepEqual(calls, []);
  assert.deepEqual(events, []);
});

test("갱신할 리프레시 토큰이 없으면 서버에 가지 않고 게스트를 끝낸다", async () => {
  const calls = recordFetch(() => json({}));

  const access = await refreshAccessToken();

  assert.equal(access, null);
  assert.deepEqual(calls, []);
  assert.deepEqual(events, ["guest-ended"]);
});

test("갱신 응답이 오기 전에 다른 탭이 토큰을 돌렸으면 늦은 응답으로 덮지 않고 그 탭의 토큰을 쓴다", async () => {
  setTokens({ access_token: "old-access", refresh_token: "old-refresh" });
  recordFetch(() => {
    setTokens({ access_token: "other-tab-access", refresh_token: "other-tab-refresh" });
    return json({ access_token: "late-access", refresh_token: "late-refresh" });
  });

  const access = await refreshAccessToken("old-access");

  assert.equal(access, "other-tab-access");
  assert.equal(getAccessToken(), "other-tab-access");
  assert.equal(getRefreshToken(), "other-tab-refresh");
});

test("갱신 응답이 오기 전에 게스트가 끝났으면 늦은 응답으로 되살리지 않는다", async () => {
  setTokens({ access_token: "old-access", refresh_token: "old-refresh" });
  recordFetch(() => {
    clearTokens();
    return json({ access_token: "late-access", refresh_token: "late-refresh" });
  });

  const access = await refreshAccessToken("old-access");

  assert.equal(access, null);
  assert.equal(getRefreshToken(), null);
});
