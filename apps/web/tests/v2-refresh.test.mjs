import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import "./ts-module-loader.mjs";

process.env.NEXT_PUBLIC_API_BASE_URL = "";

const { refreshAccessToken } = await import("../src/lib/auth/refresh.ts");
const {
  clearTokens,
  getAccessToken,
  getRefreshToken,
  setTokens,
} = await import("../src/lib/auth/token-store.ts");
const { onSessionEvent } = await import("../src/lib/auth/session-events.ts");

const originalFetch = globalThis.fetch;

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  clearTokens();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  clearTokens();
});

test("동시 refresh 요청은 한 번의 fetch만 공유하고 새 토큰을 저장한다", async () => {
  setTokens({ access_token: "access-old", refresh_token: "refresh-old" });
  let fetchCount = 0;
  let releaseFetch;
  const fetchGate = new Promise((resolve) => {
    releaseFetch = resolve;
  });

  globalThis.fetch = async (url, options) => {
    fetchCount += 1;
    assert.equal(url, "/v2/auth/refresh");
    assert.equal(options.method, "POST");
    assert.equal(options.body, JSON.stringify({ refresh_token: "refresh-old" }));
    await fetchGate;
    return jsonResponse({
      access_token: "access-new",
      refresh_token: "refresh-new",
      token_type: "bearer",
      expires_in: 3600,
    });
  };

  const pending = Array.from({ length: 8 }, () => refreshAccessToken());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fetchCount, 1);

  releaseFetch();
  assert.deepEqual(await Promise.all(pending), Array(8).fill("access-new"));
  assert.equal(getAccessToken(), "access-new");
  assert.equal(getRefreshToken(), "refresh-new");
});

test("401 도중 다른 탭이 refresh를 회전하면 그 탭의 access를 채택한다", async () => {
  setTokens({ access_token: "access-old", refresh_token: "refresh-old" });

  globalThis.fetch = async () => {
    setTokens({ access_token: "access-winner", refresh_token: "refresh-winner" });
    return jsonResponse({ detail: "invalid_refresh_token" }, 401);
  };

  assert.equal(await refreshAccessToken(), "access-winner");
  assert.equal(getAccessToken(), "access-winner");
  assert.equal(getRefreshToken(), "refresh-winner");
});

test("refresh 5xx는 기존 토큰을 지우지 않는다", async () => {
  setTokens({ access_token: "access-old", refresh_token: "refresh-old" });
  globalThis.fetch = async () =>
    jsonResponse({ detail: "refresh temporarily unavailable" }, 503);

  await assert.rejects(
    refreshAccessToken(),
    (error) => error?.status === 503 && error?.code === "refresh temporarily unavailable",
  );
  assert.equal(getAccessToken(), "access-old");
  assert.equal(getRefreshToken(), "refresh-old");
});

test("동일한 refresh가 401이면 세션을 무효화하고 logout을 알린다", async () => {
  setTokens({ access_token: "access-old", refresh_token: "refresh-old" });
  let logoutCount = 0;
  const unsubscribe = onSessionEvent((event) => {
    if (event === "logout") logoutCount += 1;
  });
  globalThis.fetch = async () =>
    jsonResponse({ detail: "invalid_refresh_token" }, 401);

  try {
    assert.equal(await refreshAccessToken(), null);
    assert.equal(getAccessToken(), null);
    assert.equal(getRefreshToken(), null);
    assert.equal(logoutCount, 1);
  } finally {
    unsubscribe();
  }
});

test("실패한 access보다 이미 새 토큰이 저장돼 있으면 fetch 없이 재사용한다", async () => {
  setTokens({ access_token: "access-current", refresh_token: "refresh-current" });
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    throw new Error("unexpected fetch");
  };

  assert.equal(await refreshAccessToken("access-stale"), "access-current");
  assert.equal(fetchCount, 0);
  assert.equal(getRefreshToken(), "refresh-current");
});
