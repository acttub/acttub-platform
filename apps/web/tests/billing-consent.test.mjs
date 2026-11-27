// 새 판 문서를 결정하지 않은 회원의 구독 칸·구독 버튼(2026-11-27 QA). 회원 게이트는 선택 문서의 미결정도
// 막는다(account.consent). 공용 클라이언트가 받은 403 consent_required 로 루트의 <ConsentSheetHost /> 가
// 시트를 띄우고, 동의하면 막혔던 요청을 다시 보내 칸이 그대로 이어지는지, 닫으면 칸에 동의 안내가 남는지 본다.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { afterEach, beforeEach, test } from "node:test";

import "./ts-module-loader.mjs";
import { react, window } from "./mount-probe.mjs";
import "./fixtures/features-next-shims.mjs";

process.env.NEXT_PUBLIC_API_BASE_URL = "";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "posthog-js") {
      return { url: new URL("./fixtures/posthog-js.mjs", import.meta.url).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const { cleanup, fireEvent, render, screen, within } = await import("@testing-library/react");
const { ConsentSheetHost } = await import("../src/features/consent/consent-sheet.tsx");
const { analyticsConsentGate } = await import("../src/features/analytics/analytics.tsx");
const { SubscriptionCard } = await import("../src/features/billing/subscription-card.tsx");
const { SubscribeButton } = await import("../src/features/billing/subscribe-button.tsx");
const { clearTokens, setMemberTokens } = await import("../src/lib/auth/token-store.ts");

const DOCUMENTS = {
  terms: { title: "서비스 이용약관", required: true },
  data_sharing: { title: "영상 데이터 제3자 제공", required: false },
};

function consentDocument(type) {
  return {
    id: `${type}-document`,
    type,
    version: "v1",
    title: DOCUMENTS[type].title,
    body: `${type} 전문`,
    required: DOCUMENTS[type].required,
    published_at: "2026-11-20T00:00:00.000000Z",
  };
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const ACTIVE = {
  status: "active",
  pro: true,
  amount: 3900,
  period_end: "2026-12-20T00:00:00Z",
  next_billing_at: "2026-12-20T00:00:00Z",
  card_company: "현대",
  card_last4: "1234",
  provider: "toss",
};

/** 회원 서버. `pending` 이 남아 있는 동안 결제 API 를 403 consent_required 로 막는다. */
function serve(pending) {
  const server = { pending: new Set(pending), calls: [], consents: [] };
  globalThis.fetch = async (url, options = {}) => {
    const route = `${options.method ?? "GET"} ${String(url)}`;
    server.calls.push(route);
    if (route === "GET /v2/consents/entry") {
      return jsonResponse({ documents: [{ type: "privacy", current_decision: "granted" }] });
    }
    if (route === "POST /v2/consents") {
      const body = JSON.parse(options.body);
      server.consents.push(body);
      server.pending.delete(body.document_id.replace("-document", ""));
      return jsonResponse({ id: `event-${server.consents.length}` }, 201);
    }
    if (server.pending.size > 0) {
      return jsonResponse(
        { detail: "consent_required", pending_consents: [...server.pending].map(consentDocument) },
        403,
      );
    }
    if (route === "GET /v2/billing/me") return jsonResponse(ACTIVE);
    if (route === "POST /v2/billing/checkout") {
      return jsonResponse({
        checkout_url: "https://acttub.com/billing/checkout/abc",
        return_url: "https://acttub.com/billing/result",
        expires_at: "2026-11-27T10:30:00Z",
      });
    }
    return jsonResponse({ detail: "not_found" }, 404);
  };
  return server;
}

function settle() {
  return new Promise((resolve) => setImmediate(resolve));
}

async function act(run) {
  await react.act(async () => {
    run();
    for (let i = 0; i < 8; i += 1) await settle();
  });
}

const sheetName = "계속하려면 동의가 필요해요";
const originalFetch = globalThis.fetch;

beforeEach(() => {
  window.localStorage.clear();
  clearTokens();
  setMemberTokens(
    { access_token: "member-access", refresh_token: "member-refresh" },
    { id: "member-1", email: "actor@example.com", status: "active" },
    "google",
  );
});

afterEach(async () => {
  const close = screen.queryByRole("button", { name: "동의 창 닫기" });
  if (close) await act(() => fireEvent.click(close));
  cleanup();
  analyticsConsentGate.suspend();
  globalThis.fetch = originalFetch;
  clearTokens();
  window.localStorage.clear();
});

async function mount(element) {
  await act(() => {
    render(
      react.createElement(
        react.Fragment,
        null,
        react.createElement(ConsentSheetHost),
        element,
      ),
    );
  });
}

test("구독 칸: 선택 문서가 빠진 회원에게도 시트가 뜨고, 동의하면 다시 읽어 구독 정보를 보여 준다", async () => {
  const server = serve(["terms", "data_sharing"]);
  await mount(react.createElement(SubscriptionCard));

  const dialog = screen.getByRole("dialog", { name: sheetName });
  assert.deepEqual(
    within(dialog).getAllByRole("listitem").map((item) => item.textContent),
    ["필수서비스 이용약관보기", "선택영상 데이터 제3자 제공보기"],
  );
  // 나이 확인 줄은 게스트의 첫 시트에만 있다.
  assert.equal(within(dialog).queryByRole("checkbox", { name: "만 14세 이상이에요" }), null);
  assert.equal(within(dialog).getByRole("checkbox", { name: /영상 데이터 제3자 제공/ }).checked, false);

  await act(() => fireEvent.click(screen.getByRole("button", { name: "동의하고 계속하기" })));

  assert.deepEqual(server.consents, [
    { document_id: "terms-document", action: "granted" },
    { document_id: "data_sharing-document", action: "declined" },
  ]);
  assert.equal(screen.queryByRole("dialog"), null);
  assert.ok(screen.getByText("Pro 이용 중"));
  assert.equal(server.calls.filter((call) => call === "GET /v2/billing/me").length, 2);
});

test("구독 칸: 시트를 닫으면 동의 안내와 다시 여는 버튼이 남고, 누르면 시트가 다시 뜬다", async () => {
  serve(["data_sharing"]);
  await mount(react.createElement(SubscriptionCard));

  await act(() => fireEvent.click(screen.getByRole("button", { name: "동의 창 닫기" })));

  assert.equal(screen.queryByRole("dialog"), null);
  assert.ok(screen.getByText(/새 약관 동의가 필요해요/));
  assert.equal(screen.queryByText(/구독 정보를 불러오지 못했어요/), null);

  await act(() => fireEvent.click(screen.getByRole("button", { name: "동의 문서 보기" })));
  assert.ok(screen.getByRole("dialog", { name: sheetName }));

  await act(() => fireEvent.click(screen.getByRole("checkbox", { name: /영상 데이터 제3자 제공/ })));
  await act(() => fireEvent.click(screen.getByRole("button", { name: "동의하고 계속하기" })));
  assert.ok(screen.getByText("Pro 이용 중"));
});

test("구독 버튼: 막힌 회원에게 시트를 띄우고, 동의하면 결제 창 주소를 다시 받는다", async () => {
  const server = serve(["data_sharing"]);
  await mount(react.createElement(SubscribeButton, { className: "" }, "Pro 구독하기"));
  await act(() => fireEvent.click(screen.getByRole("button", { name: "Pro 구독하기" })));
  assert.ok(screen.getByRole("dialog", { name: sheetName }));

  await act(() => fireEvent.click(screen.getByRole("button", { name: "동의하고 계속하기" })));

  assert.deepEqual(server.consents, [{ document_id: "data_sharing-document", action: "declined" }]);
  // 두 번째 체크아웃이 주소를 받았고 오류 문구가 없다. 이동(location.assign)은 jsdom 이 하지 않는다.
  assert.equal(server.calls.filter((call) => call === "POST /v2/billing/checkout").length, 2);
  assert.equal(screen.queryByRole("alert"), null);
});

test("구독 버튼: 시트를 닫으면 일반 오류가 아니라 동의 안내를 보인다", async () => {
  serve(["terms"]);
  await mount(react.createElement(SubscribeButton, { className: "" }, "Pro 구독하기"));
  await act(() => fireEvent.click(screen.getByRole("button", { name: "Pro 구독하기" })));
  await act(() => fireEvent.click(screen.getByRole("button", { name: "동의 창 닫기" })));

  assert.equal(
    screen.getByRole("alert").textContent,
    "새 약관 동의가 필요해요. 다시 누르면 동의 문서를 볼 수 있어요.",
  );
});
