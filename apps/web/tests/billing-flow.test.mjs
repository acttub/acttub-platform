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
