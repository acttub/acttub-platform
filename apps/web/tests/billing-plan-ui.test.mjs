// billing.subscription(SOMA-1068) — 웹 연 구독 요금제 선택. 체크아웃 본문은 plan 이 없으면 지금과 같고, 있으면 plan 을 싣는다.
// /pricing Pro 카드의 월/연 선택은 기본이 월이고 두 칸 라디오다.
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import "./ts-module-loader.mjs";

process.env.NEXT_PUBLIC_API_BASE_URL = "";

const React = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { startBillingCheckout } = await import("../src/lib/api/v2/billing.ts");
const { clearTokens, setTokens } = await import("../src/lib/auth/token-store.ts");
const { PlanSubscribe, SubscribeButton } = await import("../src/features/billing/subscribe-button.tsx");

const originalFetch = globalThis.fetch;

beforeEach(() => {
  setTokens({ access_token: "member-access", refresh_token: "member-refresh" });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  clearTokens();
});

function recordFetch() {
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ method: init.method, url: String(url), body: init.body === undefined ? undefined : JSON.parse(init.body) });
    return new Response(JSON.stringify({ checkout_url: "https://acttub.com/billing/checkout/abc", expires_at: "2026-11-08T10:30:00Z" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  return requests;
}

test("plan 을 주지 않으면 체크아웃 본문은 지금처럼 purpose 뿐이다", async () => {
  const requests = recordFetch();
  await startBillingCheckout();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, "POST");
  assert.deepEqual(requests[0].body, { purpose: "subscribe" });
});

test("plan 을 주면 체크아웃 본문에 plan 을 싣는다", async () => {
  const requests = recordFetch();
  await startBillingCheckout({ plan: "yearly" });
  await startBillingCheckout({ plan: "monthly" });
  assert.deepEqual(requests[0].body, { purpose: "subscribe", plan: "yearly" });
  assert.deepEqual(requests[1].body, { purpose: "subscribe", plan: "monthly" });
});

test("월/연 선택은 두 칸 라디오이고 기본은 월이며 구독 버튼이 함께 나온다", () => {
  const html = renderToStaticMarkup(React.createElement(PlanSubscribe, { className: "btn" }, "Pro 구독하기"));
  assert.match(html, /요금제 선택/);
  const radios = html.match(/type="radio"/g) ?? [];
  assert.equal(radios.length, 2);
  assert.match(html, /월 3,900원/);
  assert.match(html, /연 32,500원/);
  const inputs = html.match(/<input[^>]*>/g) ?? [];
  assert.match(inputs.find((tag) => tag.includes('value="monthly"')) ?? "", /checked/);
  assert.doesNotMatch(inputs.find((tag) => tag.includes('value="yearly"')) ?? "", /checked/);
  assert.match(html, /Pro 구독하기/);
});

test("구독 버튼만 쓸 때는 지금처럼 버튼 하나다", () => {
  const html = renderToStaticMarkup(React.createElement(SubscribeButton, { className: "btn" }, "Pro 구독하기"));
  assert.doesNotMatch(html, /type="radio"/);
  assert.match(html, /<button[^>]*class="btn"/);
  assert.match(html, /Pro 구독하기/);
});
