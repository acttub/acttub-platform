// "옮겼어요" 안내를 띄우는 상태. 옮겨졌다는 답이 어떤 요청에서 오든, 액세스 403 이든 갱신
// 401 이든 같은 안내로 가야 한다(account.guest) — 그 배선을 실제로 렌더해서 본다.
import assert from "node:assert/strict";
import { afterEach, before, beforeEach, test } from "node:test";

import "./ts-module-loader.mjs";
import { mountProbe as mount, react, window } from "./mount-probe.mjs";

process.env.NEXT_PUBLIC_API_BASE_URL = "";

let Probe;
let navigationsSoFar;
let resetNavigations;
let apiFetch;
let clearTokens;
let setTokens;

before(async () => {
  ({ GuestTransferredProbe: Probe, navigationsSoFar, resetNavigations } =
    await import("./fixtures/guest-transferred-probe.tsx"));
  ({ apiFetch } = await import("../src/lib/api/v2/client.ts"));
  ({ clearTokens, setTokens } = await import("../src/lib/auth/token-store.ts"));
});

const originalFetch = globalThis.fetch;

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  window.localStorage.clear();
  clearTokens();
  resetNavigations();
  setTokens(
    { access_token: "guest-access", refresh_token: "guest-refresh" },
    { id: "guest-1", email: null, status: "active" },
  );
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  clearTokens();
  window.localStorage.clear();
});

test("account.guest: 옮긴 뒤 웹을 새로 고쳐 첫 요청이 403 guest_transferred 면 '옮겼어요' 안내가 뜬다", async () => {
  globalThis.fetch = async () => jsonResponse({ detail: "guest_transferred" }, 403);
  const probe = mount(Probe);
  try {
    assert.equal(probe.latest.transferred, false);

    await react.act(async () => {
      await apiFetch("/v2/practice-sessions").catch(() => undefined);
    });

    assert.equal(probe.latest.transferred, true);
  } finally {
    probe.unmount();
  }
});

test("account.guest: 액세스 토큰이 만료돼 갱신에서 401 guest_transferred 가 와도 같은 안내다", async () => {
  globalThis.fetch = async (url) =>
    String(url) === "/v2/auth/refresh"
      ? jsonResponse({ detail: "guest_transferred" }, 401)
      : jsonResponse({ detail: "invalid or missing access token" }, 401);
  const probe = mount(Probe);
  try {
    await react.act(async () => {
      await apiFetch("/v2/practice-sessions").catch(() => undefined);
    });

    assert.equal(probe.latest.transferred, true);
  } finally {
    probe.unmount();
  }
});

test("account.guest: 그냥 끝난 게스트(갱신 거절)에는 '옮겼어요' 안내를 띄우지 않는다", async () => {
  globalThis.fetch = async (url) =>
    String(url) === "/v2/auth/refresh"
      ? jsonResponse({ detail: "invalid_refresh_token" }, 401)
      : jsonResponse({ detail: "invalid or missing access token" }, 401);
  const probe = mount(Probe);
  try {
    await react.act(async () => {
      await apiFetch("/v2/practice-sessions").catch(() => undefined);
    });

    assert.equal(probe.latest.transferred, false);
  } finally {
    probe.unmount();
  }
});

test("account.guest: 새로 시작을 누르면 안내를 거두고 빈 연습 화면으로 간다 — 게스트는 그때 만들지 않는다", async () => {
  const routes = [];
  globalThis.fetch = async (url, options = {}) => {
    routes.push(`${options.method ?? "GET"} ${String(url)}`);
    return jsonResponse({ detail: "guest_transferred" }, 403);
  };
  const probe = mount(Probe);
  try {
    await react.act(async () => {
      await apiFetch("/v2/practice-sessions").catch(() => undefined);
    });

    probe.act((value) => value.startOver());

    assert.equal(probe.latest.transferred, false);
    assert.deepEqual(navigationsSoFar(), ["/practice/new"]);
    assert.deepEqual(routes, ["GET /v2/practice-sessions"]);
  } finally {
    probe.unmount();
  }
});
