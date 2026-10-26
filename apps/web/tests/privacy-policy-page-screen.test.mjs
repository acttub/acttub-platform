// 개인정보 처리방침 공개 페이지(/privacy). 스토어·푸터·앱이 가리키는 주소다. /terms 와 같은 고지
// (GET /v2/consents/notices)를 받아 서버 정본(consent-docs/privacy_policy.md) 전문을 그대로 그린다.
// 받는 동안은 스켈레톤, 못 받으면 빈 화면 대신 짧은 안내와 다시 시도.
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import "./ts-module-loader.mjs";
import { react } from "./mount-probe.mjs";
import "./fixtures/features-next-shims.mjs";

process.env.NEXT_PUBLIC_API_BASE_URL = "";

const { act, cleanup, render, screen, fireEvent } = await import("@testing-library/react");
const { PrivacyPolicyPage } = await import("../src/features/consent/privacy-policy-page.tsx");
const { loadPrivacyPolicy, PrivacyPolicyMissingError } = await import(
  "../src/features/consent/privacy-policy.ts"
);
const { clearTokens, hasGuestSession } = await import("../src/lib/auth/token-store.ts");

const originalFetch = globalThis.fetch;

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const privacyPolicy = {
  type: "privacy_policy",
  title: "개인정보 처리방침",
  body: "# Acttub 개인정보 처리방침\n\n수탁사와 위탁 업무를 적어요.",
};

function serve(queue) {
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const path = new URL(String(input), "http://web.test").pathname;
    calls.push(`${init.method ?? "GET"} ${path}`);
    if (path !== "/v2/consents/notices") throw new Error(`예상하지 못한 요청: ${path}`);
    return queue.length > 1 ? queue.shift()() : queue[0]();
  };
  return calls;
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
  });
}

beforeEach(() => clearTokens());

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

test("처리방침 전문을 받아 그리고, 받는 동안에는 스켈레톤을 보인다", async () => {
  const calls = serve([() => jsonResponse({ notices: [privacyPolicy] })]);

  render(react.createElement(PrivacyPolicyPage));
  const skeleton = screen.getByRole("status", { name: "개인정보 처리방침을 불러오는 중" });
  assert.equal(skeleton.getAttribute("aria-busy"), "true");
  assert.equal(screen.queryByText("수탁사와 위탁 업무를 적어요."), null);
  await settle();

  assert.equal(screen.queryByRole("status"), null);
  assert.ok(screen.getByRole("heading", { level: 1, name: "개인정보 처리방침" }));
  assert.ok(screen.getByRole("heading", { level: 3, name: "Acttub 개인정보 처리방침" }));
  assert.ok(screen.getByText("수탁사와 위탁 업무를 적어요."));
  assert.equal(screen.getByRole("link", { name: "안전 약속" }).getAttribute("href"), "/terms");

  // 열람용이다. 버튼이 없고, 이 페이지 때문에 게스트가 생기지도 않는다.
  assert.deepEqual(screen.queryAllByRole("button"), []);
  assert.deepEqual(calls, ["GET /v2/consents/notices"]);
  assert.equal(hasGuestSession(), false);
});

test("못 받으면 빈 화면 대신 안내와 다시 시도를 보이고, 다시 시도하면 다시 받는다", async () => {
  const calls = serve([
    () => jsonResponse({ detail: "internal_server_error" }, 500),
    () => jsonResponse({ notices: [privacyPolicy] }),
  ]);

  render(react.createElement(PrivacyPolicyPage));
  await settle();

  assert.ok(
    screen.getByRole("heading", { level: 1, name: "개인정보 처리방침을 불러오지 못했어요" }),
  );
  assert.ok(screen.getByRole("alert").textContent.trim().length > 0);

  fireEvent.click(screen.getByRole("button", { name: "다시 시도하기" }));
  assert.ok(screen.getByRole("status", { name: "개인정보 처리방침을 불러오는 중" }));
  await settle();

  assert.ok(screen.getByText("수탁사와 위탁 업무를 적어요."));
  assert.deepEqual(calls, ["GET /v2/consents/notices", "GET /v2/consents/notices"]);
});

test("응답에 처리방침이 없으면 빈 페이지 대신 실패로 다룬다", async () => {
  serve([() => jsonResponse({ notices: [] })]);
  await assert.rejects(loadPrivacyPolicy(), PrivacyPolicyMissingError);

  render(react.createElement(PrivacyPolicyPage));
  await settle();
  assert.ok(screen.getByRole("alert"));
  assert.ok(screen.getByRole("button", { name: "다시 시도하기" }));
});
