// 계측(GA4 쿠키·Amplitude)을 켜도 되는지의 관문(SOMA-528 결정 I-6 개정). 단일 기준은 서버다 —
// 게스트 토큰이 있고 GET /v2/consents/entry 의 privacy 행이 granted 일 때만 켠다. 토큰이 없거나,
// 행이 없거나, 값이 다르거나, 조회가 실패하면 끈다. 계측 판단용 localStorage 복제는 두지 않는다.
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import "./ts-module-loader.mjs";
import { window } from "./dom-setup.mjs";

process.env.NEXT_PUBLIC_API_BASE_URL = "";

const { createAnalyticsConsentGate, isPrivacyGranted } = await import(
  "../src/features/consent/analytics-consent.ts"
);
const { clearTokens, setTokens } = await import(
  "../src/lib/auth/token-store.ts"
);

const originalFetch = globalThis.fetch;

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function entryDocument(type, currentDecision) {
  return {
    id: `${type}-document`,
    type,
    version: "2026-10-01",
    title: `${type} 문서`,
    body: `${type} 전문`,
    required: true,
    published_at: "2026-10-01T00:00:00.000000Z",
    current_decision: currentDecision,
    decided_at: currentDecision ? "2026-10-02T03:11:09.120000Z" : null,
  };
}

function entry(...documents) {
  const undecided = documents.filter((document) => document.current_decision === null);
  return {
    entry_status: undecided.length > 0 ? "decision_required" : "allowed",
    documents,
    undecided_documents: undecided,
  };
}

/** 서버의 동의 현황. `current` 를 갈아 끼우면 다음 조회부터 그 답이 온다. */
function serveEntry(initial) {
  const server = { current: initial, calls: [] };
  globalThis.fetch = async (url, options = {}) => {
    const headers = new Headers(options.headers);
    server.calls.push({
      route: `${options.method ?? "GET"} ${String(url)}`,
      authorization: headers.get("Authorization"),
    });
    if (server.current instanceof Error) throw server.current;
    if (typeof server.current === "number") {
      return jsonResponse({ detail: "internal_server_error" }, server.current);
    }
    return jsonResponse(server.current);
  };
  return server;
}

/** 켜고 끄는 스위치를 받아 적는다. 마지막 상태와 지나온 길을 함께 본다. */
function recordSwitch() {
  const log = [];
  return {
    log,
    get state() {
      return log.at(-1) ?? "off";
    },
    measurement: {
      on: (userId) => log.push(`on:${userId}`),
      off: () => log.push("off"),
    },
  };
}

function startGuest(id = "guest-1") {
  setTokens(
    { access_token: `${id}-access`, refresh_token: `${id}-refresh` },
    { id, email: null, status: "active" },
  );
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

test("계측 I-6: privacy 행이 granted 일 때만 켠다(순수 판단)", () => {
  assert.equal(isPrivacyGranted(entry(entryDocument("privacy", "granted"))), true);
  assert.equal(isPrivacyGranted(entry(entryDocument("privacy", "declined"))), false);
  assert.equal(isPrivacyGranted(entry(entryDocument("privacy", "revoked"))), false);
  assert.equal(isPrivacyGranted(entry(entryDocument("privacy", null))), false);
  assert.equal(isPrivacyGranted(entry(entryDocument("terms", "granted"))), false);
  assert.equal(isPrivacyGranted(entry()), false);
  assert.equal(isPrivacyGranted(null), false);
  assert.equal(isPrivacyGranted({ documents: "깨진 응답" }), false);
});

test("계측 I-6: 게스트의 privacy 가 granted 면 게스트 토큰으로 물어 켠다", async () => {
  const server = serveEntry(
    entry(entryDocument("terms", "granted"), entryDocument("privacy", "granted")),
  );
  const recorded = recordSwitch();
  const gate = createAnalyticsConsentGate(recorded.measurement);

  assert.equal(await gate.check(), true);

  assert.equal(recorded.state, "on:guest-1");
  assert.deepEqual(server.calls, [
    { route: "GET /v2/consents/entry", authorization: "Bearer guest-1-access" },
  ]);
});

test("계측 I-6: declined·revoked·미결정·행 없음은 끈다", async () => {
  for (const documents of [
    [entryDocument("privacy", "declined")],
    [entryDocument("privacy", "revoked")],
    [entryDocument("privacy", null)],
    [entryDocument("terms", "granted")],
  ]) {
    serveEntry(entry(...documents));
    const recorded = recordSwitch();
    const gate = createAnalyticsConsentGate(recorded.measurement);

    assert.equal(await gate.check(), false);
    assert.equal(recorded.state, "off");
    assert.equal(recorded.log.some((line) => line.startsWith("on:")), false);
  }
});

test("계측 I-6: 게스트 토큰이 없으면(랜딩만 본 방문자) 끄고 서버에 묻지도 않는다 — 게스트도 만들지 않는다", async () => {
  clearTokens();
  const server = serveEntry(entry(entryDocument("privacy", "granted")));
  const recorded = recordSwitch();
  const gate = createAnalyticsConsentGate(recorded.measurement);

  assert.equal(await gate.check(), false);

  assert.equal(recorded.state, "off");
  assert.deepEqual(server.calls, []);
});

test("계측 I-6: 조회가 실패하면 끈다(닫힌 쪽으로 실패)", async () => {
  for (const failure of [500, new TypeError("fetch failed")]) {
    serveEntry(failure);
    const recorded = recordSwitch();
    const gate = createAnalyticsConsentGate(recorded.measurement);

    assert.equal(await gate.check(), false);
    assert.equal(recorded.state, "off");
  }
});

test("계측 I-6: 조회 중에는 꺼진 상태다 — 켜져 있었어도 답이 올 때까지 끈다", async () => {
  const server = serveEntry(entry(entryDocument("privacy", "granted")));
  const recorded = recordSwitch();
  const gate = createAnalyticsConsentGate(recorded.measurement);
  await gate.check();
  assert.equal(recorded.state, "on:guest-1");

  const checking = gate.check();
  assert.equal(recorded.state, "off");
  assert.equal(await checking, true);
  assert.equal(recorded.state, "on:guest-1");
  assert.equal(server.calls.length, 2);
});

// 403 consent_required 로 시트가 열리는 순간 시트가 이것을 부른다. 실제 403 이 여기까지 닿는
// 배선은 tests/consent-sheet-host.test.mjs 가 시트를 띄워서 본다.
test("계측 I-6: suspend 는 켜져 있던 계측을 서버에 묻지 않고 즉시 끈다", async () => {
  const server = serveEntry(entry(entryDocument("privacy", "granted")));
  const recorded = recordSwitch();
  const gate = createAnalyticsConsentGate(recorded.measurement);
  await gate.check();
  assert.equal(recorded.state, "on:guest-1");
  server.calls.length = 0;

  gate.suspend();

  assert.equal(recorded.state, "off");
  assert.deepEqual(server.calls, []);
});

test("계측 I-6: 조회하는 사이 시트가 열리면 늦게 온 granted 로 다시 켜지 않는다", async () => {
  serveEntry(entry(entryDocument("privacy", "granted")));
  const recorded = recordSwitch();
  const gate = createAnalyticsConsentGate(recorded.measurement);

  const checking = gate.check();
  gate.suspend();

  assert.equal(await checking, false);
  assert.equal(recorded.state, "off");
  assert.equal(recorded.log.some((line) => line.startsWith("on:")), false);
});

test("계측 I-6: 탭이 다시 보일 때의 재조회로 어긋남(새 판 발행)을 발견하면 끈다", async () => {
  const server = serveEntry(entry(entryDocument("privacy", "granted")));
  const recorded = recordSwitch();
  const gate = createAnalyticsConsentGate(recorded.measurement);
  await gate.check();
  assert.equal(recorded.state, "on:guest-1");

  // 탭이 가려진 사이 privacy 의 새 판이 나왔다. 현재 판에 대한 결정이 없다.
  server.current = entry(entryDocument("privacy", null));
  assert.equal(await gate.check(), false);

  assert.equal(recorded.state, "off");
});

test("계측 I-6: 동의 제출 직후 다시 물어 켠다", async () => {
  const server = serveEntry(entry(entryDocument("privacy", null)));
  const recorded = recordSwitch();
  const gate = createAnalyticsConsentGate(recorded.measurement);
  assert.equal(await gate.check(), false);

  gate.suspend();
  server.current = entry(entryDocument("privacy", "granted"));
  assert.equal(await gate.check(), true);

  assert.equal(recorded.state, "on:guest-1");
});

test("계측 I-6: 새 게스트가 시작되면 앞 게스트의 켜짐을 물려받지 않는다", async () => {
  const server = serveEntry(entry(entryDocument("privacy", "granted")));
  const recorded = recordSwitch();
  const gate = createAnalyticsConsentGate(recorded.measurement);
  await gate.check();

  clearTokens();
  gate.suspend();
  startGuest("guest-2");
  server.current = entry(entryDocument("privacy", null));

  assert.equal(await gate.check(), false);
  assert.equal(recorded.state, "off");
});

test("계측 I-6: 계측 판단을 localStorage 에 복제하지 않는다", async () => {
  serveEntry(entry(entryDocument("privacy", "granted")));
  const gate = createAnalyticsConsentGate(recordSwitch().measurement);
  const before = Object.keys(window.localStorage).sort();

  await gate.check();

  assert.deepEqual(Object.keys(window.localStorage).sort(), before);
  assert.equal(window.localStorage.getItem("acttub.guest.accepted_privacy"), null);
});
