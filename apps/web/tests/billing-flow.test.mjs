import assert from "node:assert/strict";
import test from "node:test";

import {
  resultViewOf,
  returnStatusOf,
  safeCheckoutUrl,
  startMessage,
  startOutcomeOf,
} from "../src/features/billing/billing-flow.ts";

test("웹 결제 시작 오류를 사용자에게 보일 상태로 가른다", () => {
  assert.equal(startOutcomeOf({ status: 403, code: "billing_member_required" }).kind, "login_required");
  assert.equal(startOutcomeOf({ status: 401, code: "unauthorized" }).kind, "login_required");
  assert.equal(startOutcomeOf({ status: 404, code: "billing_unavailable" }).kind, "unavailable");
  assert.equal(startOutcomeOf({ status: 409, code: "already_subscribed" }).kind, "already_subscribed");
  assert.equal(startOutcomeOf({ status: 409, code: "payment_pending" }).kind, "payment_pending");
  assert.equal(startOutcomeOf(new Error("boom")).kind, "error");
  assert.match(startMessage({ kind: "unavailable" }), /준비/);
  assert.equal(startMessage({ kind: "redirect", url: "https://x" }), null);
});

test("카드 등록 창 주소는 https 나 개발용 루프백만 따라간다", () => {
  assert.equal(safeCheckoutUrl("https://api.acttub.com/v2/billing/web/checkout/s"), "https://api.acttub.com/v2/billing/web/checkout/s");
  assert.equal(safeCheckoutUrl("http://localhost:8080/v2/billing/web/checkout/s"), "http://localhost:8080/v2/billing/web/checkout/s");
  assert.equal(safeCheckoutUrl("http://evil.example/x"), null);
  assert.equal(safeCheckoutUrl("javascript:alert(1)"), null);
  assert.equal(safeCheckoutUrl(undefined), null);
});

test("결제 뒤 돌아온 주소의 status 만 읽고, 성립은 서버 상태로 본다", () => {
  assert.equal(returnStatusOf("?status=done"), "done");
  assert.equal(returnStatusOf("?status=canceled"), "canceled");
  assert.equal(returnStatusOf("?status=hacked"), null);
  assert.equal(returnStatusOf(""), null);
  assert.equal(resultViewOf("failed", true).tone, "ok");
  assert.equal(resultViewOf("done", false).tone, "wait");
  assert.equal(resultViewOf("unknown", false).tone, "wait");
  assert.equal(resultViewOf("failed", false).tone, "fail");
  assert.equal(resultViewOf(null, false).tone, "fail");
});

test("내 계정 구독 칸은 서버 상태를 그대로 문장으로 바꾼다", async () => {
  const { subscriptionViewOf, cancelDoneMessage, koreanDate } = await import("../src/features/billing/billing-flow.ts");
  const base = { amount: 3900, card_company: null, card_last4: null, grant_ends_at: null, period_end: null, next_billing_at: null };
  const active = subscriptionViewOf({ ...base, status: "active", pro: true, provider: "toss", next_billing_at: "2026-11-30T06:29:37Z", period_end: "2026-11-30T06:29:37Z", card_last4: "123*" });
  assert.equal(active.title, "Pro 이용 중");
  assert.equal(active.cancelable, true);
  assert.ok(active.lines.includes("월 3,900원 자동결제"));
  assert.ok(active.lines.includes("다음 결제일 2026년 11월 30일"));
  assert.ok(active.lines.includes("카드 끝자리 123*"));

  const canceled = subscriptionViewOf({ ...base, status: "canceled", pro: true, provider: "toss", period_end: "2026-11-30T06:29:37Z" });
  assert.equal(canceled.cancelable, false);
  assert.match(canceled.lines[0], /2026년 11월 30일까지 Pro/);
  assert.equal(cancelDoneMessage({ ...base, status: "canceled", pro: true, period_end: "2026-11-30T06:29:37Z" }), "해지했어요. 2026년 11월 30일까지 Pro를 쓸 수 있어요.");

  const store = subscriptionViewOf({ ...base, status: "active", pro: true, provider: "google" });
  assert.equal(store.cancelable, false);
  assert.match(store.lines[0], /Google Play의 구독 관리/);

  const grant = subscriptionViewOf({ ...base, status: "none", pro: true, provider: null, grant_ends_at: "2026-11-07T14:59:59Z" });
  assert.equal(grant.title, "Pro 무료 이용 중");
  assert.match(grant.lines[0], /2026년 11월 7일까지/);

  const free = subscriptionViewOf({ ...base, status: "none", pro: false, provider: null });
  assert.equal(free.title, "무료로 쓰고 있어요");
  assert.equal(free.showPricing, true);

  // 한국 시간 자정 넘김: UTC 15:00 은 다음 날이다.
  assert.equal(koreanDate("2026-11-30T15:00:00Z"), "2026년 12월 1일");
  assert.equal(koreanDate("bad"), null);
});

test("로그인이 필요하면 안내 문구가 웹 로그인을 가리킨다", () => {
  assert.match(startMessage({ kind: "login_required" }), /로그인/);
  assert.doesNotMatch(startMessage({ kind: "login_required" }), /준비 중/);
});
