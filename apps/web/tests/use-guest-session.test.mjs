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

test("account.guest: 0.1.0 이전 웹 로그인이 남긴 회원 토큰은 게스트로 치지 않는다", () => {
  window.localStorage.setItem("acttub.refresh_token", "member-refresh");
  window.localStorage.setItem("acttub.access_token", "member-access");

  const probe = mount(Probe);
  try {
    assert.equal(probe.latest.hasSession, false);
  } finally {
    probe.unmount();
  }
});

/** 다른 탭의 localStorage 쓰기가 이 탭에 도착한 것. 값부터 바뀌어 있고 그 뒤에 이벤트가 온다. */
function fromAnotherTab(key, oldValue, newValue) {
  if (key !== null) {
    if (newValue === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, newValue);
  }
  react.act(() => {
    window.dispatchEvent(new window.StorageEvent("storage", { key, oldValue, newValue }));
  });
}

test("account.guest: 다른 탭에서 게스트가 시작되거나 끝나면 이 탭의 화면도 따라온다", () => {
  const probe = mount(Probe);
  try {
    fromAnotherTab("acttub.guest.refresh_token", null, "other-tab-refresh");
    assert.equal(probe.latest.hasSession, true);

    // 다른 탭의 SDK 가 쓰는 무관한 키는 화면을 다시 그리지 않는다.
    const renders = probe.everyRender.length;
    fromAnotherTab("ph_phc_project_posthog", null, "{}");
    assert.equal(probe.everyRender.length, renders);

    fromAnotherTab("acttub.guest.refresh_token", "other-tab-refresh", null);
    assert.equal(probe.latest.hasSession, false);
  } finally {
    probe.unmount();
  }
});

test(
  "account.guest: 다른 탭이 저장소를 통째로 비우면 이 탭의 화면도 게스트 없음으로 돌아간다",
  () => {
    const probe = mount(Probe);
    try {
      fromAnotherTab("acttub.guest.refresh_token", null, "other-tab-refresh");
      assert.equal(probe.latest.hasSession, true);

      window.localStorage.clear();
      fromAnotherTab(null, null, null);
      assert.equal(probe.latest.hasSession, false);
    } finally {
      probe.unmount();
    }
  },
);
