// pg-review.test.mjs 가 보지 않는 SDK 호출 전 검사와 결과 문구의 남은 갈래.
import assert from "node:assert/strict";
import { test } from "node:test";

import "./ts-module-loader.mjs";

const { checkoutProblem, describeResult } = await import("../src/features/pg-review/pg-review-flow.ts");

const ORIGIN = "https://acttub.example";
const good = {
  clientKey: "test_ck_abc",
  customerKey: "cust-1",
  successUrl: `${ORIGIN}/v2/pg-review/success?state=s1`,
  failUrl: `${ORIGIN}/v2/pg-review/fail?state=s1`,
};

test("주소로 읽을 수 없거나 조각(#)이 붙은 콜백, 300자를 넘는 고객 키는 SDK 로 넘기지 않는다", () => {
  assert.equal(checkoutProblem({ ...good, successUrl: "http://[bad" }, ORIGIN), "invalid_success_url");
  assert.equal(checkoutProblem({ ...good, failUrl: `${good.failUrl}#x` }, ORIGIN), "invalid_fail_url");
  assert.equal(checkoutProblem({ ...good, customerKey: "c".repeat(301) }, ORIGIN), "invalid_customer_key");
  assert.equal(checkoutProblem({ ...good, customerKey: "c".repeat(300) }, ORIGIN), null);
});

test("실패 결과의 한글 안내는 그대로 보이고, 안내가 없으면 기본 문구를 쓴다", () => {
  const base = { testOnly: true, amount: 3900, status: "failed" };
  assert.equal(describeResult({ ...base, message: "카드사에서 거절했어요." }).body, "카드사에서 거절했어요.");
  assert.equal(
    describeResult(base).body,
    "카드 등록이나 승인이 끝나지 않았어요. 승인된 결제는 없어요. 다시 시도할 수 있어요.",
  );
});
