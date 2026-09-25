// 동의 문서 공개 페이지(/terms, account.consent). 동의 문서의 현재 판 전문과 개인정보
// 처리방침(고지) 전문을 누구에게나 보여 준다. 처리방침은 결정 대상이 아니다(결정 I-6).
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import "./ts-module-loader.mjs";

process.env.NEXT_PUBLIC_API_BASE_URL = "";

const { listConsentNotices } = await import("../src/lib/api/v2/consents.ts");
const { loadConsentDocumentsPage } = await import(
  "../src/features/consent/consent-documents.ts"
);
const { clearTokens, hasGuestSession, setTokens } = await import(
  "../src/lib/auth/token-store.ts"
);

const originalFetch = globalThis.fetch;

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** 경로마다 다른 응답을 주고, 온 요청을 적어 둔다. */
function routeFetch(routes) {
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const path = new URL(String(input), "http://web.test").pathname;
    const headers = new Headers(init.headers);
    calls.push({ route: `${init.method ?? "GET"} ${path}`, headers });
    const respond = routes[path];
    if (!respond) throw new Error(`예상하지 못한 요청: ${path}`);
    return respond();
  };
  return calls;
}

const termsDocument = {
  id: "0f0e0d0c-0b0a-4908-8706-050403020100",
  type: "terms",
  // 서버가 주는 판은 "v1" 모양이다(계약 스모크에서 확인).
  version: "v1",
  title: "이용약관",
  body: "# 이용약관",
  required: true,
  published_at: "2026-09-01T00:00:00.000000Z",
};

const privacyPolicy = {
  type: "privacy_policy",
  title: "개인정보 처리방침",
  body: "# 개인정보 처리방침\n\n5. 위탁 현황",
};

beforeEach(() => {
  clearTokens();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  clearTokens();
});

test("account.consent: 처리방침 고지는 로그인 없이 부르고 게스트를 만들지 않는다", async () => {
  const calls = routeFetch({
    "/v2/consents/notices": () => jsonResponse({ notices: [privacyPolicy] }),
  });

  const { notices } = await listConsentNotices();

  assert.deepEqual(notices, [privacyPolicy]);
  assert.deepEqual(calls.map((call) => call.route), ["GET /v2/consents/notices"]);
  assert.equal(calls[0].headers.has("Authorization"), false);
  assert.equal(calls[0].headers.get("X-Acttub-Client"), "web/1.0.0");
  assert.equal(hasGuestSession(), false);
});

test("account.consent: 게스트 토큰이 있어도 처리방침 고지 조회에는 싣지 않는다", async () => {
  setTokens({ access_token: "guest-access", refresh_token: "guest-refresh" });
  const calls = routeFetch({
    "/v2/consents/notices": () => jsonResponse({ notices: [privacyPolicy] }),
  });

  await listConsentNotices();

  assert.equal(calls[0].headers.has("Authorization"), false);
});

test("account.consent: 공개 페이지는 동의 문서의 현재 판과 처리방침 고지를 함께 받는다", async () => {
  const calls = routeFetch({
    "/v2/consents/documents": () => jsonResponse({ documents: [termsDocument] }),
    "/v2/consents/notices": () => jsonResponse({ notices: [privacyPolicy] }),
  });

  const page = await loadConsentDocumentsPage();

  assert.deepEqual(page, { documents: [termsDocument], notices: [privacyPolicy] });
  assert.deepEqual(calls.map((call) => call.route).sort(), [
    "GET /v2/consents/documents",
    "GET /v2/consents/notices",
  ]);
  assert.equal(hasGuestSession(), false);
});

test("account.consent: 처리방침 고지를 못 받으면 고지 없는 반쪽 페이지를 그리지 않고 실패로 알린다", async () => {
  routeFetch({
    "/v2/consents/documents": () => jsonResponse({ documents: [termsDocument] }),
    "/v2/consents/notices": () => jsonResponse({ detail: "internal_error" }, 500),
  });

  await assert.rejects(loadConsentDocumentsPage(), (error) => error?.status === 500);
});
