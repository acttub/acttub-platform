import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import "./ts-module-loader.mjs";

process.env.NEXT_PUBLIC_API_BASE_URL = "";

const { apiFetch } = await import("../src/lib/api/v2/client.ts");
const { listConsentDocuments } = await import("../src/lib/api/v2/consents.ts");
const { errorMessage } = await import("../src/lib/api/v2/errors.ts");
const { refreshAccessToken } = await import("../src/lib/auth/refresh.ts");
const { onSessionEvent } = await import("../src/lib/auth/session-events.ts");
const {
  clearTokens,
  getAccessToken,
  getRefreshToken,
  hasGuestSession,
  setTokens,
} = await import("../src/lib/auth/token-store.ts");

const originalFetch = globalThis.fetch;

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function guestTokens(suffix = "1") {
  return {
    access_token: `guest-access-${suffix}`,
    refresh_token: `guest-refresh-${suffix}`,
    token_type: "bearer",
    expires_in: 1800,
    user: { id: `guest-${suffix}`, email: null, status: "active" },
    account_type: "guest",
  };
}

/** 부른 순서대로 `METHOD 경로`를 적어 두는 가짜 서버. */
function recordFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const call = {
      route: `${options.method ?? "GET"} ${String(url)}`,
      headers: new Headers(options.headers),
      body: options.body,
    };
    calls.push(call);
    return handler(call, calls);
  };
  return calls;
}

beforeEach(() => {
  clearTokens();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  clearTokens();
});

test("account.guest: 동의 문서 같은 공개 조회는 게스트를 만들지 않는다", async () => {
  const calls = recordFetch(() => jsonResponse({ documents: [] }));

  await listConsentDocuments();

  assert.deepEqual(calls.map((call) => call.route), ["GET /v2/consents/documents"]);
  assert.equal(calls[0].headers.has("Authorization"), false);
  assert.equal(hasGuestSession(), false);
});

test("account.guest: 토큰 없이 보호 조회를 불러도 게스트를 만들지 않고 서버에 가지 않는다", async () => {
  const calls = recordFetch(() => jsonResponse({ sessions: [] }));

  await assert.rejects(
    apiFetch("/v2/practices"),
    (error) => error?.status === 401 && error?.code === "guest_session_required",
  );

  assert.deepEqual(calls, []);
  assert.equal(hasGuestSession(), false);
});

test("account.guest: 처음 보호 기능을 쓰려 할 때 POST /v2/auth/guest로 토큰을 받아 그 토큰으로 요청한다", async () => {
  const calls = recordFetch((call) =>
    call.route === "POST /v2/auth/guest"
      ? jsonResponse(guestTokens(), 201)
      : jsonResponse({ intent_id: "intent-1" }, 201),
  );
  const events = [];
  const unsubscribe = onSessionEvent((event) => events.push(event));

  try {
    const { data } = await apiFetch("/v2/videos/intents", {
      method: "POST",
      body: { filename: "take.mp4" },
    });

    assert.deepEqual(data, { intent_id: "intent-1" });
    assert.deepEqual(calls.map((call) => call.route), [
      "POST /v2/auth/guest",
      "POST /v2/videos/intents",
    ]);
    assert.equal(calls[0].body, undefined);
    assert.equal(calls[0].headers.has("Authorization"), false);
    assert.equal(calls[1].headers.get("Authorization"), "Bearer guest-access-1");
    // 브라우저에 리프레시 토큰이 남아야 다음 방문에도 같은 게스트다.
    assert.equal(getRefreshToken(), "guest-refresh-1");
    assert.deepEqual(events, ["guest-started"]);
  } finally {
    unsubscribe();
  }
});

test("account.guest: 동시에 시작한 보호 요청 여럿이 게스트를 하나만 만든다", async () => {
  const calls = recordFetch(async (call) => {
    if (call.route === "POST /v2/auth/guest") {
      await new Promise((resolve) => setImmediate(resolve));
      return jsonResponse(guestTokens(), 201);
    }
    return jsonResponse({ ok: true });
  });

  await Promise.all([
    apiFetch("/v2/videos/intents", { method: "POST", body: {} }),
    apiFetch("/v2/videos/intents", { method: "POST", body: {} }),
    apiFetch("/v2/videos/intents", { method: "POST", body: {} }),
  ]);

  assert.equal(
    calls.filter((call) => call.route === "POST /v2/auth/guest").length,
    1,
  );
  assert.equal(
    calls.filter((call) => call.route === "POST /v2/videos/intents").length,
    3,
  );
});

test("account.guest: 이미 게스트 토큰이 있으면 다시 만들지 않는다", async () => {
  setTokens({ access_token: "guest-access-0", refresh_token: "guest-refresh-0" });
  const calls = recordFetch(() => jsonResponse({ ok: true }));

  await apiFetch("/v2/videos/intents", { method: "POST", body: {} });

  assert.deepEqual(calls.map((call) => call.route), ["POST /v2/videos/intents"]);
  assert.equal(calls[0].headers.get("Authorization"), "Bearer guest-access-0");
});

test("account.guest: 한 IP에서 한 시간에 열한 번째 게스트(429)는 안내 문구로 돌려준다", async () => {
  const calls = recordFetch(() =>
    jsonResponse({ detail: "rate limit exceeded" }, 429),
  );

  let caught;
  try {
    await apiFetch("/v2/videos/intents", { method: "POST", body: {} });
  } catch (error) {
    caught = error;
  }

  assert.equal(caught?.status, 429);
  assert.deepEqual(calls.map((call) => call.route), ["POST /v2/auth/guest"]);
  assert.equal(errorMessage(caught, "기본 문구"), "잠시 뒤 다시 시도해 주세요.");
  assert.equal(hasGuestSession(), false);
});

test("account.guest: 갱신이 401이면 토큰을 지우고 새 게스트로 같은 요청을 다시 보낸다", async () => {
  setTokens(
    { access_token: "guest-access-old", refresh_token: "guest-refresh-old" },
    { id: "guest-old", email: null, status: "active" },
  );
  const calls = recordFetch((call) => {
    if (call.route === "POST /v2/auth/refresh") {
      return jsonResponse({ detail: "invalid_refresh_token" }, 401);
    }
    if (call.route === "POST /v2/auth/guest") {
      return jsonResponse(guestTokens("2"), 201);
    }
    return call.headers.get("Authorization") === "Bearer guest-access-2"
      ? jsonResponse({ intent_id: "intent-2" }, 201)
      : jsonResponse({ detail: "invalid or missing access token" }, 401);
  });
  const events = [];
  const unsubscribe = onSessionEvent((event) => events.push(event));

  try {
    const { data } = await apiFetch("/v2/videos/intents", {
      method: "POST",
      body: { filename: "take.mp4" },
    });

    assert.deepEqual(data, { intent_id: "intent-2" });
    assert.deepEqual(calls.map((call) => call.route), [
      "POST /v2/videos/intents",
      "POST /v2/auth/refresh",
      "POST /v2/auth/guest",
      "POST /v2/videos/intents",
    ]);
    assert.equal(calls[3].body, calls[0].body);
    assert.equal(getRefreshToken(), "guest-refresh-2");
    assert.deepEqual(events, ["guest-ended", "guest-started"]);
  } finally {
    unsubscribe();
  }
});

test("account.guest: 갱신이 401인 보호 조회는 새 게스트를 만들지 않고 세션이 끝났다고 알린다", async () => {
  setTokens({ access_token: "guest-access-old", refresh_token: "guest-refresh-old" });
  const calls = recordFetch((call) =>
    call.route === "POST /v2/auth/refresh"
      ? jsonResponse({ detail: "invalid_refresh_token" }, 401)
      : jsonResponse({ detail: "invalid or missing access token" }, 401),
  );
  const events = [];
  const unsubscribe = onSessionEvent((event) => events.push(event));

  try {
    await assert.rejects(
      apiFetch("/v2/practices"),
      (error) => error?.status === 401,
    );

    assert.deepEqual(calls.map((call) => call.route), [
      "GET /v2/practices",
      "POST /v2/auth/refresh",
    ]);
    assert.equal(getAccessToken(), null);
    assert.equal(getRefreshToken(), null);
    assert.deepEqual(events, ["guest-ended"]);
  } finally {
    unsubscribe();
  }
});

test("account.guest: 갱신 요청이 네트워크 오류로 실패하면 게스트 토큰을 지우지 않는다", async () => {
  setTokens({ access_token: "guest-access-old", refresh_token: "guest-refresh-old" });
  globalThis.fetch = async () => {
    throw new TypeError("fetch failed");
  };

  await assert.rejects(refreshAccessToken(), (error) => error?.name === "NetworkError");

  assert.equal(getRefreshToken(), "guest-refresh-old");
});

test("공통 규칙: 보호 요청·공개 요청·갱신·게스트 만들기 모두 X-Acttub-Client가 web/1.0.0이다", async () => {
  setTokens({ access_token: "guest-access-old", refresh_token: "guest-refresh-old" });
  const calls = recordFetch((call) => {
    if (call.route === "POST /v2/auth/refresh") {
      return jsonResponse({
        access_token: "guest-access-new",
        refresh_token: "guest-refresh-new",
        token_type: "bearer",
        expires_in: 1800,
      });
    }
    if (call.route === "POST /v2/auth/guest") {
      return jsonResponse(guestTokens("3"), 201);
    }
    if (call.route === "GET /v2/practices") {
      return call.headers.get("Authorization") === "Bearer guest-access-new"
        ? jsonResponse({ sessions: [] })
        : jsonResponse({ detail: "invalid or missing access token" }, 401);
    }
    return jsonResponse({ ok: true });
  });

  await apiFetch("/v2/practices");
  await apiFetch("/v2/admissions", { auth: false });
  clearTokens();
  await apiFetch("/v2/videos/intents", { method: "POST", body: {} });

  assert.deepEqual(calls.map((call) => call.route), [
    "GET /v2/practices",
    "POST /v2/auth/refresh",
    "GET /v2/practices",
    "GET /v2/admissions",
    "POST /v2/auth/guest",
    "POST /v2/videos/intents",
  ]);
  for (const call of calls) {
    assert.equal(call.headers.get("X-Acttub-Client"), "web/1.0.0", call.route);
    assert.equal(call.headers.has("X-Acttub-Consent-Entry"), false, call.route);
  }
});

test("account.withdraw: 파기된 게스트의 남은 액세스 토큰(403 account_deactivated)이면 토큰을 지우고 새 게스트로 같은 요청을 다시 보낸다", async () => {
  setTokens({ access_token: "guest-access-old", refresh_token: "guest-refresh-old" });
  const calls = recordFetch((call) => {
    if (call.route === "POST /v2/auth/guest") {
      return jsonResponse(guestTokens("4"), 201);
    }
    return call.headers.get("Authorization") === "Bearer guest-access-4"
      ? jsonResponse({ intent_id: "intent-4" }, 201)
      : jsonResponse({ detail: "account_deactivated" }, 403);
  });
  const events = [];
  const unsubscribe = onSessionEvent((event) => events.push(event));

  try {
    const { data } = await apiFetch("/v2/videos/intents", {
      method: "POST",
      body: { filename: "take.mp4" },
    });

    assert.deepEqual(data, { intent_id: "intent-4" });
    assert.deepEqual(calls.map((call) => call.route), [
      "POST /v2/videos/intents",
      "POST /v2/auth/guest",
      "POST /v2/videos/intents",
    ]);
    assert.equal(getRefreshToken(), "guest-refresh-4");
    assert.deepEqual(events, ["guest-ended", "guest-started"]);
  } finally {
    unsubscribe();
  }
});

test("account.withdraw: 403 account_deactivated인 보호 조회는 토큰만 지우고 새 게스트를 만들지 않는다", async () => {
  setTokens({ access_token: "guest-access-old", refresh_token: "guest-refresh-old" });
  const calls = recordFetch(() =>
    jsonResponse({ detail: "account_deactivated" }, 403),
  );

  await assert.rejects(
    apiFetch("/v2/practices"),
    (error) => error?.status === 403 && error?.code === "account_deactivated",
  );

  assert.deepEqual(calls.map((call) => call.route), ["GET /v2/practices"]);
  assert.equal(hasGuestSession(), false);
});
