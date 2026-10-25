// 고객센터 문의 접수(SOMA-834). 로그인하지 않은 방문자도 보낼 수 있고, 문의하려고 게스트를 만들지 않는다.
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import "./ts-module-loader.mjs";

process.env.NEXT_PUBLIC_API_BASE_URL = "";

const { submitInquiry } = await import("../src/lib/api/v2/support.ts");
const { INQUIRY_CATEGORY, INQUIRY_TYPES } = await import("../src/features/help/help-content.ts");
const { clearTokens, setTokens } = await import("../src/lib/auth/token-store.ts");

const originalFetch = globalThis.fetch;
let calls;

beforeEach(() => {
  clearTokens();
  calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ id: "inq-1", created_at: "2026-10-25T09:00:00Z" }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  clearTokens();
});

const input = { category: "bug", email: "a@example.com", body: "리딩 화면에서 소리가 안 나요." };

test("세션이 없으면 토큰 없이 한 번만 보내고 게스트를 만들지 않는다", async () => {
  const created = await submitInquiry(input);
  assert.deepEqual(created, { id: "inq-1", created_at: "2026-10-25T09:00:00Z" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/v2/support/inquiries");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.get("Authorization"), null);
  assert.ok(calls[0].init.headers.get("X-Acttub-Client"));
  assert.deepEqual(JSON.parse(calls[0].init.body), input);
});

test("세션이 있으면 그 토큰을 실어 누가 보냈는지 남긴다", async () => {
  setTokens({ access_token: "member-access", refresh_token: "member-refresh" });
  await submitInquiry(input);
  assert.equal(calls[0].init.headers.get("Authorization"), "Bearer member-access");
});

test("화면의 문의 유형은 모두 서버 category 하나에 닿는다", () => {
  const categories = INQUIRY_TYPES.map((type) => INQUIRY_CATEGORY[type]);
  assert.equal(categories.every(Boolean), true);
  assert.equal(new Set(categories).size, INQUIRY_TYPES.length);
});
