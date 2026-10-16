// PG 심사 전용 테스트 결제(SOMA-620)의 웹 쪽 행동: 전용 쿠키 API 경계와 SDK 호출 전 검사.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import "./ts-module-loader.mjs";

const api = await import("../src/lib/api/v2/pg-review.ts");
const flow = await import("../src/features/pg-review/pg-review-flow.ts");

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function mockFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init);
  };
  return calls;
}

const json = (status, body) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

test("모든 요청은 전용 쿠키만 쓰고 개인·게스트 토큰 헤더를 붙이지 않는다", async () => {
  const calls = mockFetch((url) =>
    url.endsWith("/config")
      ? json(200, { available: true, authenticated: false, testOnly: true, amount: 3900 })
      : json(200, { authenticated: true }),
  );
  await api.getPgReviewConfig();
  await api.loginPgReview("reviewer", "secret-value");
  assert.equal(calls.length, 2);
  for (const { url, init } of calls) {
    assert.match(url, /\/v2\/pg-review\//);
    assert.equal(init.credentials, "include");
    assert.equal(new Headers(init.headers).has("Authorization"), false);
  }
  assert.equal(calls[1].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[1].init.body), { username: "reviewer", password: "secret-value" });
});

test("닫힌 환경의 404 는 오류가 아니라 열려 있지 않음이다", async () => {
  mockFetch(() => json(404, { detail: "not_found" }));
  const config = await api.getPgReviewConfig();
  assert.equal(config.available, false);
});

test("로그인 실패 401 은 재시도 없이 한 번만 요청하고 던진다", async () => {
  const calls = mockFetch(() => json(401, { detail: "invalid_credentials" }));
  await assert.rejects(api.loginPgReview("a", "b"), (error) => error.status === 401);
  assert.equal(calls.length, 1);
});

test("체크아웃·결과는 서버 값을 검증해 받고 모양이 다르면 거절한다", async () => {
  mockFetch(() => json(200, { clientKey: "test_ck_abc", customerKey: "c1", successUrl: "s", failUrl: "f" }));
  const checkout = await api.createPgReviewCheckout();
  assert.equal(checkout.customerKey, "c1");

  mockFetch(() => json(200, { clientKey: "test_ck_abc" }));
  await assert.rejects(api.createPgReviewCheckout(), (e) => e.code === "malformed_response");

  mockFetch(() => json(200, { status: "approved", testOnly: true, amount: 1, orderId: "o1", approvedAt: "2026-11-02T00:00:00Z" }));
  const result = await api.getPgReviewResult();
  assert.equal(result.status, "approved");
  assert.equal(result.amount, 3900, "금액은 서버 값이 아니라 고정 3900 으로 보인다");

  mockFetch(() => json(200, { status: "weird" }));
  await assert.rejects(api.getPgReviewResult(), (e) => e.code === "malformed_response");
});

test("로그아웃은 204 와 이미 끝난 세션 401 을 모두 성공으로 본다", async () => {
  mockFetch(() => new Response(null, { status: 204 }));
  await api.logoutPgReview();
  mockFetch(() => json(401, { detail: "unauthorized" }));
  await api.logoutPgReview();
});

const ORIGIN = "https://acttub.example";
const good = {
  clientKey: "test_ck_abcDEF-12_3",
  customerKey: "cust-1",
  successUrl: `${ORIGIN}/v2/pg-review/success?state=s1`,
  failUrl: `${ORIGIN}/v2/pg-review/fail?state=s1`,
};

test("test_ck_ 키와 같은 출처 콜백만 SDK 로 넘긴다", () => {
  assert.equal(flow.checkoutProblem(good, ORIGIN), null);
  assert.equal(flow.checkoutProblem({ ...good, clientKey: "live_ck_abc" }, ORIGIN), "live_or_invalid_client_key");
  assert.equal(flow.checkoutProblem({ ...good, clientKey: "test_gck_abc" }, ORIGIN), "live_or_invalid_client_key");
  assert.equal(flow.checkoutProblem({ ...good, customerKey: "" }, ORIGIN), "invalid_customer_key");
  assert.equal(
    flow.checkoutProblem({ ...good, successUrl: "https://evil.example/v2/pg-review/success?state=s1" }, ORIGIN),
    "invalid_success_url",
  );
  assert.equal(
    flow.checkoutProblem({ ...good, successUrl: `${ORIGIN}/v2/pg-review/success` }, ORIGIN),
    "invalid_success_url",
  );
  assert.equal(
    flow.checkoutProblem({ ...good, failUrl: `${ORIGIN}/other?state=s1` }, ORIGIN),
    "invalid_fail_url",
  );
  assert.equal(flow.checkoutProblem({ ...good, successUrl: "/v2/pg-review/success?state=s1" }, ORIGIN), null);
});

test("결과 문구는 서버 상태만 옮기고 unknown 에서는 다시 결제하게 하지 않는다", () => {
  const base = { testOnly: true, amount: 3900 };
  assert.equal(flow.describeResult({ ...base, status: "approved" }).canRetry, false);
  assert.equal(flow.describeResult({ ...base, status: "processing" }).polling, true);
  const unknown = flow.describeResult({ ...base, status: "unknown" });
  assert.equal(unknown.canRetry, false);
  assert.equal(unknown.polling, false);
  assert.equal(flow.describeResult({ ...base, status: "failed" }).canRetry, true);
  assert.equal(flow.describeResult({ ...base, status: "idle" }).tone, "neutral");
  assert.match(flow.describeResult({ ...base, status: "failed", message: "english only" }).body, /승인된 결제는 없어요/);
});

test("사용자 취소 코드는 오류로 보이지 않는다", () => {
  assert.equal(flow.isUserCancel({ code: "USER_CANCEL" }), true);
  assert.equal(flow.isUserCancel({ code: "INVALID_CARD" }), false);
  assert.equal(flow.isUserCancel(null), false);
});
