// 동의 시트와 계측 관문의 배선(SOMA-528 결정 I-6). 관문의 규칙 자체는 analytics-consent.test.mjs 가
// 돌려 보고, 여기서는 루트에 놓이는 <ConsentSheetHost /> 를 실제로 띄워 공용 클라이언트가 받은
// 진짜 403 consent_required 가 그 관문에 닿는지를 본다 — 시트가 열리는 순간 끄고, 닫기만 해도
// 다시 묻고, 동의 제출 직후에 다시 묻는다.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { after, afterEach, before, beforeEach, test } from "node:test";

import "./ts-module-loader.mjs";
import { react, window } from "./mount-probe.mjs";

process.env.NEXT_PUBLIC_API_BASE_URL = "";
process.env.NEXT_PUBLIC_AMPLITUDE_API_KEY = "test-amplitude-key";

// SDK 의 네트워크가 아니라 우리가 켜고 끄는지만 본다(analytics-amplitude.test.mjs 와 같은 목).
const amplitudeMockUrl = `data:text/javascript,${encodeURIComponent(`
const calls = globalThis.__amplitudeCalls;
export const init = (...args) => calls.push(["init", ...args]);
export const add = (...args) => calls.push(["add", ...args]);
export const track = (...args) => calls.push(["track", ...args]);
export const setUserId = (...args) => calls.push(["setUserId", ...args]);
export const reset = (...args) => calls.push(["reset", ...args]);
export const setOptOut = (...args) => calls.push(["setOptOut", ...args]);
`)}`;
const replayMockUrl = `data:text/javascript,${encodeURIComponent(`
export const sessionReplayPlugin = () => ({ name: "session-replay" });
`)}`;
// 시트는 관문을 analytics.tsx 에서 가져오고, 그 모듈은 usePathname 을 import 한다.
const navigationMockUrl = `data:text/javascript,${encodeURIComponent(`
export const usePathname = () => "/home";
`)}`;

globalThis.__amplitudeCalls = [];
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@amplitude/analytics-browser") {
      return { url: amplitudeMockUrl, shortCircuit: true };
    }
    if (specifier === "@amplitude/plugin-session-replay-browser") {
      return { url: replayMockUrl, shortCircuit: true };
    }
    if (specifier === "next/navigation") {
      return { url: navigationMockUrl, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

let ConsentSheetHost;
let analyticsConsentGate;
let apiFetch;
let clearTokens;
let setTokens;

before(async () => {
  ({ ConsentSheetHost } = await import("../src/features/consent/consent-sheet.tsx"));
  ({ analyticsConsentGate } = await import("../src/features/analytics/analytics.tsx"));
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

function consentDocument(type) {
  return {
    id: `${type}-document`,
    type,
    version: "v2",
    title: `${type} 문서`,
    body: `${type} 전문`,
    required: true,
    published_at: "2026-10-01T00:00:00.000000Z",
  };
}

/**
 * 서버. `pending` 에 든 종류의 문서가 빠져 있는 동안 보호 기능(POST /v2/example)을 403 으로 막고,
 * 결정(POST /v2/consents)을 받으면 그 문서를 채운다. 동의 현황의 privacy 행은 privacy 가 빠져
 * 있지 않을 때만 granted 다.
 */
function serve(pending) {
  const server = { pending: new Set(pending), calls: [] };
  globalThis.fetch = async (url, options = {}) => {
    const route = `${options.method ?? "GET"} ${String(url)}`;
    server.calls.push(route);
    if (route === "GET /v2/consents/entry") {
      return jsonResponse({
        documents: [
          {
            type: "privacy",
            current_decision: server.pending.has("privacy") ? null : "granted",
          },
        ],
      });
    }
    if (route === "POST /v2/consents") {
      const { document_id: documentId } = JSON.parse(options.body);
      server.pending.delete(documentId.replace("-document", ""));
      return jsonResponse({ id: "consent-event" }, 201);
    }
    if (server.pending.size > 0) {
      return jsonResponse(
        {
          detail: "consent_required",
          pending_consents: [...server.pending].map(consentDocument),
        },
        403,
      );
    }
    return jsonResponse({ ok: true }, 201);
  };
  return server;
}

/** 마지막으로 SDK 에 건 opt-out. 켜져 있으면 false(또는 건 적 없음), 꺼졌으면 true. */
function optedOut() {
  const last = globalThis.__amplitudeCalls.findLast(([name]) => name === "setOptOut");
  return last ? last[1] : false;
}

/** 목 서버는 마이크로태스크로만 답한다. 매크로태스크 한 번이면 멈출 데까지 다 흘러간다. */
function settle() {
  return new Promise((resolve) => setImmediate(resolve));
}

let container;
let reactRoot;

async function mount() {
  const { createRoot } = await import("react-dom/client");
  container = window.document.createElement("div");
  window.document.body.append(container);
  reactRoot = createRoot(container);
  react.act(() => reactRoot.render(react.createElement(ConsentSheetHost)));
}

function button(match) {
  const found = [...container.querySelectorAll("button")].find(match);
  assert.ok(found, "시트에 그 버튼이 있어야 한다");
  return found;
}

/**
 * 게스트가 보호 기능을 부른다. 시트가 뜬 데서 멈춘 요청을 돌려준다 — 약속을 그대로 돌려주면
 * async 함수가 그것이 끝나기를 기다리므로 객체에 담는다.
 */
async function callProtectedFeature() {
  let request;
  await react.act(async () => {
    request = apiFetch("/v2/example", { method: "POST", body: {} });
    request.catch(() => undefined);
    await settle();
  });
  return { request };
}

beforeEach(async () => {
  window.localStorage.clear();
  clearTokens();
  setTokens(
    { access_token: "guest-1-access", refresh_token: "guest-1-refresh" },
    { id: "guest-1", email: null, status: "active" },
  );
  // 나이 확인은 이미 한 게스트다. 시트에 확인 줄이 없다.
  window.localStorage.setItem("acttub.guest.age_confirmed", "guest-1");
  await mount();
});

afterEach(async () => {
  // 시트를 열어 둔 채 끝내면 공용 클라이언트가 그 시트를 계속 기다려(promptInFlight) 다음
  // 테스트의 403 이 새 시트를 띄우지 못한다.
  const close = [...container.querySelectorAll("button")].find(
    (node) => node.getAttribute("aria-label") === "동의 창 닫기",
  );
  if (close) {
    await react.act(async () => {
      close.click();
      await settle();
    });
  }
  react.act(() => reactRoot.unmount());
  container.remove();
  analyticsConsentGate.suspend();
  globalThis.fetch = originalFetch;
  clearTokens();
  window.localStorage.clear();
});

after(() => {
  delete globalThis.__amplitudeCalls;
});

test("계측 I-6: 켜진 뒤 실제 403 consent_required 로 시트가 열리면 제출을 기다리지 않고 즉시 끈다", async () => {
  const server = serve([]);
  await analyticsConsentGate.check();
  assert.equal(optedOut(), false);

  // 그 사이 AI 분석 동의의 새 판이 나왔다.
  server.pending.add("ai_analysis");
  server.calls.length = 0;
  await callProtectedFeature();

  assert.match(container.textContent, /계속하려면 동의가 필요해요/);
  assert.equal(optedOut(), true);
  // 아직 아무 결정도 보내지 않았고, 서버에 다시 묻지도 않았다.
  assert.deepEqual(server.calls, ["POST /v2/example"]);
});

test("계측 I-6: 시트를 닫기만 해도 다시 묻는다 — 빠진 것이 privacy 가 아니었다면 다시 켠다", async () => {
  const server = serve([]);
  await analyticsConsentGate.check();
  server.pending.add("ai_analysis");
  const blocked = await callProtectedFeature();
  assert.equal(optedOut(), true);
  server.calls.length = 0;

  await react.act(async () => {
    button((node) => node.getAttribute("aria-label") === "동의 창 닫기").click();
    await settle();
  });

  assert.deepEqual(server.calls, ["GET /v2/consents/entry"]);
  assert.equal(optedOut(), false);
  await assert.rejects(
    blocked.request,
    (error) => error?.status === 403 && error?.code === "consent_required",
  );
});

test("계측 I-6: 빠진 것이 privacy 였다면 닫은 뒤에 물어도 꺼진 채다", async () => {
  const server = serve([]);
  await analyticsConsentGate.check();
  server.pending.add("privacy");
  await callProtectedFeature();

  await react.act(async () => {
    button((node) => node.getAttribute("aria-label") === "동의 창 닫기").click();
    await settle();
  });

  assert.equal(server.calls.at(-1), "GET /v2/consents/entry");
  assert.equal(optedOut(), true);
});

test("계측 I-6: 시트에서 동의를 제출하면 그 직후에 다시 물어 켜고, 막혔던 요청이 다시 나간다", async () => {
  const server = serve(["privacy"]);
  assert.equal(await analyticsConsentGate.check(), false);
  server.calls.length = 0;
  const blocked = await callProtectedFeature();

  await react.act(async () => {
    button((node) => node.textContent === "동의하고 계속하기").click();
    await settle();
  });

  assert.deepEqual(server.calls, [
    "POST /v2/example",
    "POST /v2/consents",
    "GET /v2/consents/entry",
    "POST /v2/example",
  ]);
  assert.equal(globalThis.__amplitudeCalls.some(([name]) => name === "init"), true);
  assert.equal(optedOut(), false);
  assert.equal((await blocked.request).status, 201);
});
