// 앱으로 옮겨진 게스트의 토큰으로 온 요청(account.guest). 서버는 액세스 토큰에는 403, 갱신에는
// 401 을 주고 둘 다 사유가 guest_transferred 다. 웹은 그 사유를 먼저 갈라 "옮겼어요" 안내로
// 보내고, 계측을 끄고, 새 게스트로 조용히 이어 가지 않는다.
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import "./ts-module-loader.mjs";
import { window } from "./dom-setup.mjs";

process.env.NEXT_PUBLIC_API_BASE_URL = "";

const { apiFetch } = await import("../src/lib/api/v2/client.ts");
const { errorMessage } = await import("../src/lib/api/v2/errors.ts");
const { createAnalyticsConsentGate, watchGuestSession } = await import(
  "../src/features/consent/analytics-consent.ts"
);
const { onSessionEvent } = await import("../src/lib/auth/session-events.ts");
const { clearTokens, getRefreshToken, hasGuestSession, setTokens } =
  await import("../src/lib/auth/token-store.ts");

const originalFetch = globalThis.fetch;
const TRANSFERRED_MESSAGE =
  "이 브라우저의 연습을 앱으로 옮겼어요. 이제 앱에서 이어서 볼 수 있어요.";

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function recordFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const call = {
      route: `${options.method ?? "GET"} ${String(url)}`,
      headers: new Headers(options.headers),
    };
    calls.push(call);
    return handler(call);
  };
  return calls;
}

function startGuest(id = "guest-1") {
  setTokens(
    { access_token: `${id}-access`, refresh_token: `${id}-refresh` },
    { id, email: null, status: "active" },
  );
}

function recordEvents() {
  const events = [];
  const unsubscribe = onSessionEvent((event) => events.push(event));
  return { events, unsubscribe };
}

beforeEach(() => {
  window.localStorage.clear();
  clearTokens();
  startGuest();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  clearTokens();
  window.localStorage.clear();
});

test("account.guest: 옮겨진 게스트의 액세스 토큰(403 guest_transferred)이면 토큰을 지우고 옮겨졌다고 알린다", async () => {
  const calls = recordFetch(() => jsonResponse({ detail: "guest_transferred" }, 403));
  const { events, unsubscribe } = recordEvents();

  try {
    let caught;
    try {
      await apiFetch("/v2/practice-sessions");
    } catch (error) {
      caught = error;
    }

    assert.equal(caught?.status, 403);
    assert.equal(caught?.code, "guest_transferred");
    assert.equal(errorMessage(caught, "기본 문구"), TRANSFERRED_MESSAGE);
    assert.deepEqual(calls.map((call) => call.route), ["GET /v2/practice-sessions"]);
    assert.equal(hasGuestSession(), false);
    assert.deepEqual(events, ["guest-ended", "guest-transferred"]);
  } finally {
    unsubscribe();
  }
});

test("account.guest: 갱신 401 guest_transferred 도 같다 — 다른 기기에서 옮겼어도 같은 안내로 간다", async () => {
  const calls = recordFetch((call) =>
    call.route === "POST /v2/auth/refresh"
      ? jsonResponse({ detail: "guest_transferred" }, 401)
      : jsonResponse({ detail: "invalid or missing access token" }, 401),
  );
  const { events, unsubscribe } = recordEvents();

  try {
    let caught;
    try {
      await apiFetch("/v2/practice-sessions");
    } catch (error) {
      caught = error;
    }

    assert.equal(caught?.code, "guest_transferred");
    assert.equal(errorMessage(caught, "기본 문구"), TRANSFERRED_MESSAGE);
    assert.deepEqual(calls.map((call) => call.route), [
      "GET /v2/practice-sessions",
      "POST /v2/auth/refresh",
    ]);
    assert.equal(getRefreshToken(), null);
    assert.deepEqual(events, ["guest-ended", "guest-transferred"]);
  } finally {
    unsubscribe();
  }
});

test("account.guest: 옮겨진 게스트가 하려던 일은 새 게스트로 조용히 잇지 않는다 — 안내를 보고 새로 시작한다", async () => {
  for (const transferredAt of ["access", "refresh"]) {
    clearTokens();
    startGuest();
    const calls = recordFetch((call) => {
      if (call.route === "POST /v2/auth/refresh") {
        return jsonResponse({ detail: "guest_transferred" }, 401);
      }
      return transferredAt === "access"
        ? jsonResponse({ detail: "guest_transferred" }, 403)
        : jsonResponse({ detail: "invalid or missing access token" }, 401);
    });

    await assert.rejects(
      apiFetch("/v2/uploads/intents", { method: "POST", body: {} }),
      (error) => error?.code === "guest_transferred",
    );

    assert.equal(
      calls.some((call) => call.route === "POST /v2/auth/guest"),
      false,
      transferredAt,
    );
    assert.equal(hasGuestSession(), false, transferredAt);
  }
});

test("account.guest: 새로 시작한 뒤 처음 보호 기능을 쓰면 새 게스트가 생긴다", async () => {
  recordFetch(() => jsonResponse({ detail: "guest_transferred" }, 403));
  await assert.rejects(apiFetch("/v2/practice-sessions"));

  const calls = recordFetch((call) =>
    call.route === "POST /v2/auth/guest"
      ? jsonResponse(
          {
            access_token: "guest-2-access",
            refresh_token: "guest-2-refresh",
            token_type: "bearer",
            expires_in: 1800,
            user: { id: "guest-2", email: null, status: "active" },
            account_type: "guest",
          },
          201,
        )
      : jsonResponse({ intent_id: "intent-1" }, 201),
  );

  await apiFetch("/v2/uploads/intents", { method: "POST", body: {} });

  assert.deepEqual(calls.map((call) => call.route), [
    "POST /v2/auth/guest",
    "POST /v2/uploads/intents",
  ]);
  assert.equal(getRefreshToken(), "guest-2-refresh");
});

test("계측 I-6: 켜져 있다가 어떤 요청이든 guest_transferred 를 받으면 그 자리에서 끈다", async () => {
  const log = [];
  const gate = createAnalyticsConsentGate({
    on: (userId) => log.push(`on:${userId}`),
    off: () => log.push("off"),
  });
  const unwatch = watchGuestSession(gate);

  try {
    recordFetch(() =>
      jsonResponse({
        entry_status: "allowed",
        documents: [{ type: "privacy", current_decision: "granted" }],
        undecided_documents: [],
      }),
    );
    assert.equal(await gate.check(), true);
    assert.equal(log.at(-1), "on:guest-1");

    recordFetch(() => jsonResponse({ detail: "guest_transferred" }, 403));
    await assert.rejects(apiFetch("/v2/practice-sessions"));

    assert.equal(log.at(-1), "off");
    assert.equal(log.lastIndexOf("on:guest-1") < log.lastIndexOf("off"), true);
  } finally {
    unwatch();
  }
});

test("계측 I-6: 옮겨지는 사이 늦게 온 granted 답으로 다시 켜지 않는다", async () => {
  const log = [];
  const gate = createAnalyticsConsentGate({
    on: (userId) => log.push(`on:${userId}`),
    off: () => log.push("off"),
  });
  const unwatch = watchGuestSession(gate);
  let releaseEntry;
  const entryGate = new Promise((resolve) => {
    releaseEntry = resolve;
  });

  try {
    recordFetch(async (call) => {
      if (call.route === "GET /v2/consents/entry") {
        await entryGate;
        return jsonResponse({
          entry_status: "allowed",
          documents: [{ type: "privacy", current_decision: "granted" }],
          undecided_documents: [],
        });
      }
      return jsonResponse({ detail: "guest_transferred" }, 403);
    });

    const checking = gate.check();
    await assert.rejects(apiFetch("/v2/practice-sessions"));
    releaseEntry();

    assert.equal(await checking, false);
    assert.equal(log.some((line) => line.startsWith("on:")), false);
  } finally {
    unwatch();
  }
});
