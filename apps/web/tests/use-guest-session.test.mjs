// 화면이 조회를 가리는 훅. 게스트가 없으면 볼 자료도 없으므로 화면은 서버에 묻지 않는다 —
// 그 판단이 게스트가 생기고 끝나는 순간을 따라오는지를 실제로 렌더해서 본다.
import assert from "node:assert/strict";
import { afterEach, before, beforeEach, test } from "node:test";

import "./ts-module-loader.mjs";
import { mountProbe as mount, react, window } from "./mount-probe.mjs";

process.env.NEXT_PUBLIC_API_BASE_URL = "";

let Probe;
let apiFetch;
let clearTokens;
let setTokens;

before(async () => {
  ({ GuestSessionProbe: Probe } = await import(
    "./fixtures/guest-session-probe.tsx"
  ));
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
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  clearTokens();
  window.localStorage.clear();
});

test("account.guest: 새 브라우저로 화면을 열기만 하면 게스트가 없다", () => {
  const probe = mount(Probe);
  try {
    assert.equal(probe.latest.hasSession, false);
  } finally {
    probe.unmount();
  }
});

test("account.guest: 처음 보호 기능을 쓰는 순간 게스트가 생기고 화면이 그것을 안다", async () => {
  globalThis.fetch = async (url) =>
    String(url) === "/v2/auth/guest"
      ? jsonResponse(
          {
            access_token: "guest-access",
            refresh_token: "guest-refresh",
            token_type: "bearer",
            expires_in: 1800,
            user: { id: "guest-1", email: null, status: "active" },
            account_type: "guest",
          },
          201,
        )
      : jsonResponse({ intent_id: "intent-1" }, 201);
  const probe = mount(Probe);
  try {
    await react.act(async () => {
      await apiFetch("/v2/videos/intents", { method: "POST", body: {} });
    });

    assert.equal(probe.latest.hasSession, true);
    assert.equal(
      window.localStorage.getItem("acttub.guest.refresh_token"),
      "guest-refresh",
    );
  } finally {
    probe.unmount();
  }
});

test("account.guest: 서버가 갱신을 거절하면 게스트가 끝나고 화면은 다시 빈 상태다", async () => {
  setTokens(
    { access_token: "guest-access", refresh_token: "guest-refresh" },
    { id: "guest-1", email: null, status: "active" },
  );
  globalThis.fetch = async () =>
    jsonResponse({ detail: "invalid_refresh_token" }, 401);
  const probe = mount(Probe);
  try {
    assert.equal(probe.latest.hasSession, true);

    await react.act(async () => {
      await apiFetch("/v2/practices").catch(() => undefined);
    });

    assert.equal(probe.latest.hasSession, false);
    assert.equal(window.localStorage.getItem("acttub.guest.refresh_token"), null);
  } finally {
    probe.unmount();
  }
});

test("account.guest: 1.0.0 이전 웹 로그인이 남긴 회원 토큰은 게스트로 치지 않는다", () => {
  window.localStorage.setItem("acttub.refresh_token", "member-refresh");
  window.localStorage.setItem("acttub.access_token", "member-access");

  const probe = mount(Probe);
  try {
    assert.equal(probe.latest.hasSession, false);
  } finally {
    probe.unmount();
  }
});
