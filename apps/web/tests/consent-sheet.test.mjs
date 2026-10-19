// 게스트의 기능별 동의 시트(account.guest). 공용 클라이언트가 보호 기능에서 403 consent_required 를
// 받으면 루트의 <ConsentSheetHost /> 가 빠진 문서로 시트를 띄운다. 여기서는 시트를 실제로 그려
// 누르고, 서버에 간 동의 요청 본문과 화면에 남은 결과를 본다. 계측 관문과의 배선 자체는
// consent-sheet-host.test.mjs 가 본다.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { afterEach, before, beforeEach, test } from "node:test";

import "./ts-module-loader.mjs";
import { react, window } from "./mount-probe.mjs";
import { sdk } from "./fixtures/posthog-js.mjs";

process.env.NEXT_PUBLIC_API_BASE_URL = "";
process.env.NEXT_PUBLIC_POSTHOG_KEY = "test-posthog-key";
// jsdom 주소가 localhost 라 개발자 PC 가드에 걸린다. 동의 제출 이벤트가 나가는지까지 본다.
process.env.NEXT_PUBLIC_POSTHOG_LOCAL = "1";

const navigationMockUrl = `data:text/javascript,${encodeURIComponent(`
export const usePathname = () => "/home";
`)}`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "posthog-js") {
      return { url: new URL("./fixtures/posthog-js.mjs", import.meta.url).href, shortCircuit: true };
    }
    if (specifier === "next/navigation") {
      return { url: navigationMockUrl, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const { cleanup, fireEvent, render, screen, within } = await import("@testing-library/react");

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

const AGE_KEY = "acttub.guest.age_confirmed";
const GUEST_NOTICE = "앱으로 옮기기 전에는 이 브라우저에서만 볼 수 있어요";

const DOCUMENTS = {
  terms: { title: "서비스 이용약관", body: "# 이용약관\n\n제1조 이 약관은 서비스 이용 조건을 정해요." },
  privacy: { title: "개인정보 수집·이용 동의", body: "수집 항목과 보유 기간" },
  ai_analysis: { title: "AI 분석 동의", body: "영상을 AI 로 분석해요" },
  retention: { title: "탈퇴 후 영상·녹음 보관·활용", body: "보관 안내", required: false },
};

function consentDocument(type) {
  const { title, body, required = true } = DOCUMENTS[type];
  return {
    id: `${type}-document`,
    type,
    version: "v2",
    title,
    body,
    required,
    published_at: "2026-10-01T00:00:00.000000Z",
  };
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * 서버. `pending` 에 든 종류가 빠져 있는 동안 보호 기능(POST /v2/example)을 403 으로 막는다.
 * 동의 결정(POST /v2/consents)은 `decide` 가 정한 대로 답하고, 받은 본문을 `consents` 에 적는다.
 */
function serve(pending, { decide } = {}) {
  const server = { pending: new Set(pending), calls: [], consents: [] };
  globalThis.fetch = async (url, options = {}) => {
    const route = `${options.method ?? "GET"} ${String(url)}`;
    server.calls.push(route);
    if (route === "GET /v2/consents/entry") {
      return jsonResponse({
        documents: [
          { type: "privacy", current_decision: server.pending.has("privacy") ? null : "granted" },
        ],
      });
    }
    if (route === "POST /v2/consents") {
      const body = JSON.parse(options.body);
      server.consents.push(body);
      const reply = decide ? await decide(body) : undefined;
      if (reply) return reply;
      server.pending.delete(body.document_id.replace("-document", ""));
      return jsonResponse({ id: `event-${server.consents.length}` }, 201);
    }
    const blocking = [...server.pending].filter((type) => DOCUMENTS[type]);
    if (blocking.length > 0) {
      return jsonResponse(
        { detail: "consent_required", pending_consents: blocking.map(consentDocument) },
        403,
      );
    }
    return jsonResponse({ ok: true }, 201);
  };
  return server;
}

function settle() {
  return new Promise((resolve) => setImmediate(resolve));
}

async function act(run) {
  await react.act(async () => {
    run();
    for (let i = 0; i < 5; i += 1) await settle();
  });
}

/** 게스트가 보호 기능을 부른다. 시트가 뜬 데서 멈춘 요청을 객체에 담아 돌려준다. */
async function callProtectedFeature() {
  let request;
  await act(() => {
    request = apiFetch("/v2/example", { method: "POST", body: {} });
    request.catch(() => undefined);
  });
  return { request };
}

const sheetName = "계속하려면 동의가 필요해요";

function agreeButton() {
  return screen.getByRole("button", { name: /동의하고 계속하기|동의 내용을 저장하고 있어요/ });
}

const originalFetch = globalThis.fetch;

beforeEach(() => {
  window.localStorage.clear();
  clearTokens();
  setTokens(
    { access_token: "guest-1-access", refresh_token: "guest-1-refresh" },
    { id: "guest-1", email: null, status: "active" },
  );
  sdk.delivered.length = 0;
  render(react.createElement(ConsentSheetHost));
});

afterEach(async () => {
  // 시트를 열어 둔 채 끝내면 공용 클라이언트가 그 시트를 계속 기다려 다음 테스트의 시트가 뜨지 않는다.
  const close = screen.queryByRole("button", { name: "동의 창 닫기" });
  if (close) {
    close.disabled = false;
    await act(() => fireEvent.click(close));
  }
  cleanup();
  analyticsConsentGate.suspend();
  globalThis.fetch = originalFetch;
  clearTokens();
  window.localStorage.clear();
});

test("account.guest: 첫 시트는 필수 문서와 만 14세 확인 줄을 보여 주고, 확인해야 동의 버튼이 켜진다", async () => {
  serve(["terms", "privacy", "ai_analysis", "retention"]);
  await callProtectedFeature();

  const dialog = screen.getByRole("dialog", { name: sheetName });
  assert.deepEqual(
    within(dialog).getAllByRole("listitem").map((item) => item.textContent),
    [
      "필수서비스 이용약관보기",
      "필수개인정보 수집·이용 동의보기",
      "필수AI 분석 동의보기",
    ],
  );
  assert.equal(screen.queryByText("탈퇴 후 영상·녹음 보관·활용"), null);
  assert.ok(screen.getByText(GUEST_NOTICE));
  assert.equal(window.document.activeElement, screen.getByRole("button", { name: "동의 창 닫기" }));
  assert.equal(window.document.body.style.overflow, "hidden");

  assert.equal(agreeButton().disabled, true);
  await act(() => fireEvent.click(screen.getByRole("checkbox", { name: "만 14세 이상이에요" })));
  assert.equal(agreeButton().disabled, false);
});

test("account.guest: 확인하고 동의하면 문서마다 granted 를 보내고 시트를 닫은 뒤 막혔던 요청이 다시 나간다", async () => {
  const server = serve(["terms", "privacy", "ai_analysis"]);
  const blocked = await callProtectedFeature();

  await act(() => fireEvent.click(screen.getByRole("checkbox", { name: "만 14세 이상이에요" })));
  await act(() => fireEvent.click(agreeButton()));

  assert.deepEqual(server.consents, [
    { document_id: "terms-document", action: "granted", age_confirmed: true },
    { document_id: "privacy-document", action: "granted" },
    { document_id: "ai_analysis-document", action: "granted" },
  ]);
  assert.equal(screen.queryByRole("dialog"), null);
  assert.equal(window.document.body.style.overflow, "");
  assert.equal((await blocked.request).status, 201);
  assert.equal(window.localStorage.getItem(AGE_KEY), "guest-1");
  // privacy 동의 뒤 서버가 granted 라고 답해 계측이 켜졌고, 그 뒤의 첫 이벤트가 제출 결과다.
  assert.deepEqual(
    sdk.delivered
      .filter(({ event }) => event === "consent_submitted")
      .map(({ properties }) => properties),
    [{ result: "ok" }],
  );
});

test("account.guest: \"보기\"를 누르면 전문이 시트 위에 뜨고, 닫기나 Esc 는 전문만 닫는다", async () => {
  serve(["terms", "privacy", "ai_analysis"]);
  await callProtectedFeature();

  await act(() => fireEvent.click(screen.getAllByRole("button", { name: "보기" })[0]));
  const viewer = screen.getByRole("region", { name: "서비스 이용약관" });
  assert.ok(within(viewer).getByRole("heading", { name: "이용약관" }));
  assert.ok(within(viewer).getByText("제1조 이 약관은 서비스 이용 조건을 정해요."));

  await act(() => fireEvent.click(within(viewer).getByRole("button", { name: "닫기" })));
  assert.equal(screen.queryByRole("region", { name: "서비스 이용약관" }), null);
  assert.ok(screen.getByRole("dialog", { name: sheetName }));

  await act(() => fireEvent.click(screen.getAllByRole("button", { name: "보기" })[2]));
  assert.ok(screen.getByRole("region", { name: "AI 분석 동의" }));
  await act(() => fireEvent.keyDown(window, { key: "Enter" }));
  assert.ok(screen.getByRole("region", { name: "AI 분석 동의" }));
  await act(() => fireEvent.keyDown(window, { key: "Escape" }));
  assert.equal(screen.queryByRole("region", { name: "AI 분석 동의" }), null);
  assert.ok(screen.getByRole("dialog", { name: sheetName }));
});

test("account.guest: 전문이 없을 때 Esc 를 누르면 결정 없이 시트를 닫고, 막혔던 요청은 consent_required 로 끝난다", async () => {
  const server = serve(["terms", "privacy", "ai_analysis"]);
  const blocked = await callProtectedFeature();
  server.calls.length = 0;

  await act(() => fireEvent.keyDown(window, { key: "Escape" }));

  assert.equal(screen.queryByRole("dialog"), null);
  assert.deepEqual(server.consents, []);
  // 닫기만 해도 계측 관문은 서버에 다시 묻는다.
  assert.deepEqual(server.calls, ["GET /v2/consents/entry"]);
  await assert.rejects(
    blocked.request,
    (error) => error?.status === 403 && error?.code === "consent_required",
  );
});

test("account.guest: 저장하는 동안에는 버튼 문구가 바뀌고 닫기·Esc 가 막힌다", async () => {
  let release;
  const server = serve(["ai_analysis"], {
    decide: () => new Promise((resolve) => { release = resolve; }),
  });
  window.localStorage.setItem(AGE_KEY, "guest-1");
  const blocked = await callProtectedFeature();

  await act(() => fireEvent.click(agreeButton()));

  assert.equal(agreeButton().textContent, "동의 내용을 저장하고 있어요");
  assert.equal(agreeButton().disabled, true);
  assert.equal(screen.getByRole("button", { name: "동의 창 닫기" }).disabled, true);
  await act(() => fireEvent.keyDown(window, { key: "Escape" }));
  assert.ok(screen.getByRole("dialog", { name: sheetName }));

  server.pending.delete("ai_analysis");
  await act(() => release(jsonResponse({ id: "event-1" }, 201)));

  assert.equal(screen.queryByRole("dialog"), null);
  assert.deepEqual(server.consents, [{ document_id: "ai_analysis-document", action: "granted" }]);
  assert.equal((await blocked.request).status, 201);
});

test("account.consent: 저장에 실패하면 시트를 닫지 않고 오류 문구를 보여 주며, 다시 누를 수 있다", async () => {
  const server = serve(["ai_analysis"], {
    decide: () => jsonResponse({ detail: "internal_server_error" }, 500),
  });
  window.localStorage.setItem(AGE_KEY, "guest-1");
  // privacy 는 이미 동의해 계측이 켜져 있었다. 시트가 열리는 순간 꺼지므로 실패한 제출
  // (partial_fail)은 버려진다 — 소급 전송하지 않는다(ANALYTICS.md §3 D).
  await act(() => void analyticsConsentGate.check());
  await callProtectedFeature();
  sdk.delivered.length = 0;

  await act(() => fireEvent.click(agreeButton()));

  assert.equal(screen.getByRole("alert").textContent, "동의를 저장하지 못했어요. 다시 시도해 주세요.");
  assert.ok(screen.getByRole("dialog", { name: sheetName }));
  assert.equal(agreeButton().textContent, "동의하고 계속하기");
  assert.equal(agreeButton().disabled, false);
  assert.deepEqual(server.consents, [{ document_id: "ai_analysis-document", action: "granted" }]);
  assert.deepEqual(sdk.delivered.map(({ event }) => event), []);
});

test("account.guest: 서버가 확인 없는 동의를 422 로 거절하면 확인 줄과 안내를 다시 보여 주고, 확인하면 age_confirmed 를 싣는다", async () => {
  let rejectAge = true;
  const server = serve(["ai_analysis"], {
    decide: (body) =>
      rejectAge && !body.age_confirmed
        ? jsonResponse({ detail: "age_confirmation_required" }, 422)
        : undefined,
  });
  // 이 브라우저는 확인했다고 기억하지만 서버의 기록과 어긋났다.
  window.localStorage.setItem(AGE_KEY, "guest-1");
  const blocked = await callProtectedFeature();
  assert.equal(screen.queryByRole("checkbox"), null);

  await act(() => fireEvent.click(agreeButton()));

  assert.equal(screen.getByRole("alert").textContent, "만 14세 이상인지 확인해 주세요.");
  assert.equal(screen.getByRole("checkbox", { name: "만 14세 이상이에요" }).checked, false);
  assert.equal(agreeButton().disabled, true);
  // 브라우저 안내는 게스트의 첫 시트에만 둔다. 이 시트는 처음에 확인 줄이 없었다.
  assert.equal(screen.queryByText(GUEST_NOTICE), null);

  await act(() => fireEvent.click(screen.getByRole("checkbox", { name: "만 14세 이상이에요" })));
  assert.equal(screen.queryByRole("alert"), null);
  rejectAge = false;
  await act(() => fireEvent.click(agreeButton()));

  assert.deepEqual(server.consents, [
    { document_id: "ai_analysis-document", action: "granted" },
    { document_id: "ai_analysis-document", action: "granted", age_confirmed: true },
  ]);
  assert.equal(screen.queryByRole("dialog"), null);
  assert.equal((await blocked.request).status, 201);
});

test("account.guest: 빠진 문서가 게스트가 결정할 수 없는 선택 문서뿐이면 시트를 띄우지 않고 닫은 것으로 끝낸다", async () => {
  const server = serve([]);
  globalThis.fetch = async (url, options = {}) => {
    const route = `${options.method ?? "GET"} ${String(url)}`;
    server.calls.push(route);
    if (route === "GET /v2/consents/entry") {
      return jsonResponse({ documents: [{ type: "privacy", current_decision: "granted" }] });
    }
    return jsonResponse(
      { detail: "consent_required", pending_consents: [consentDocument("retention")] },
      403,
    );
  };

  const blocked = await callProtectedFeature();

  assert.equal(screen.queryByRole("dialog"), null);
  assert.deepEqual(server.calls, ["POST /v2/example", "GET /v2/consents/entry"]);
  await assert.rejects(
    blocked.request,
    (error) => error?.status === 403 && error?.code === "consent_required",
  );
});
