// billing.pg-review 결과 화면(/pg-review/result). 서버가 세션에 둔 결과만 읽어 보이고, processing 이면 3초마다
// 최대 20번 다시 읽는다. 서버는 fetch 대역이고, 다시 읽기 예약은 window.setTimeout 대역으로 손으로 흘린다.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { afterEach, beforeEach, test } from "node:test";

import "./ts-module-loader.mjs";
import { react, window } from "./mount-probe.mjs";
import { json, serveBackend } from "./fixtures/pg-review-backend.mjs";

// Next의 Node ESM 하위 경로만 확장한다. Link 자체는 실제 컴포넌트다.
registerHooks({
  resolve(specifier, context, next) {
    return next(specifier === "next/link" ? "next/link.js" : specifier, context);
  },
});
globalThis.self = window;

const { cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const { PgReviewResultApp } = await import("../src/features/pg-review/pg-review-result.tsx");

const realFetch = globalThis.fetch;
const realSetTimeout = window.setTimeout;
const realClearTimeout = window.clearTimeout;
let timers;

beforeEach(() => {
  timers = new Map();
  let nextId = 1;
  window.setTimeout = (callback, delay) => {
    const id = nextId++;
    timers.set(id, { callback, delay });
    return id;
  };
  window.clearTimeout = (id) => {
    timers.delete(id);
  };
});

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  window.setTimeout = realSetTimeout;
  window.clearTimeout = realClearTimeout;
});

async function settle() {
  await react.act(async () => {
    for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setImmediate(resolve));
  });
}

/** 예약된 다시 읽기를 모두 지금 실행하고, 그 응답까지 흘린다. */
async function elapse() {
  const due = [...timers.values()];
  timers.clear();
  for (const { callback } of due) callback();
  await settle();
}

const delays = () => [...timers.values()].map((timer) => timer.delay);

async function open() {
  render(react.createElement(PgReviewResultApp));
  await settle();
}

const result = (fields) => json(200, { testOnly: true, amount: 3900, ...fields });
const title = () => screen.getAllByRole("heading", { level: 2 }).map((node) => node.textContent);
const actionNames = () =>
  [...screen.queryAllByRole("button"), ...screen.queryAllByRole("link")].map((node) => node.textContent);

test("승인 결과는 주문번호와 서울 시각을 보이고, 다시 결제하거나 다시 읽게 하지 않는다", async () => {
  const calls = serveBackend({
    "GET /result": result({ status: "approved", orderId: "order-1", approvedAt: "2026-11-02T00:00:00Z" }),
  });
  render(react.createElement(PgReviewResultApp));
  assert.equal(screen.getByRole("status").textContent, "결과를 불러오는 중이에요.");
  await settle();

  assert.deepEqual(title(), ["테스트 결제가 승인됐어요"]);
  const text = window.document.body.textContent;
  assert.match(text, /상품 ACTTUB Pro 월 구독 테스트 · 3,900원\(부가세 포함\)/);
  assert.match(text, /주문번호 order-1/);
  assert.match(text, /승인 시각 2026\. 11\. 2\. 9시 0분 0초/);
  assert.deepEqual(actionNames(), ["심사용 로그아웃"]);
  assert.deepEqual(delays(), []);
  assert.deepEqual(calls, ["GET /result"]);
});

test("실패 결과는 서버의 한글 안내와 오류 코드를 보이고 처음 화면으로 돌아가게 한다", async () => {
  serveBackend({
    "GET /result": result({ status: "failed", errorCode: "REJECT_CARD_COMPANY", message: "카드사에서 거절했어요." }),
  });
  await open();
  assert.deepEqual(title(), ["테스트 결제가 완료되지 않았어요"]);
  const text = window.document.body.textContent;
  assert.match(text, /카드사에서 거절했어요\./);
  assert.match(text, /오류 코드 REJECT_CARD_COMPANY/);
  assert.deepEqual(actionNames(), ["심사용 로그아웃", "처음 화면으로"]);
  assert.equal(screen.getByRole("link", { name: "처음 화면으로" }).getAttribute("href"), "/pg-review");
});

test("결과 불명은 새로 결제하게 하지 않고 오류 코드도 숨기며, 다시 확인만 할 수 있다", async () => {
  const calls = serveBackend({
    "GET /result": [
      result({ status: "unknown", orderId: "order-2", errorCode: "verification_mismatch", approvedAt: "not-a-date" }),
      result({ status: "approved", orderId: "order-2" }),
    ],
  });
  await open();
  assert.deepEqual(title(), ["결과를 아직 알 수 없어요"]);
  const text = window.document.body.textContent;
  assert.doesNotMatch(text, /verification_mismatch/);
  assert.match(text, /승인 시각 not-a-date/);
  assert.deepEqual(actionNames(), ["결과 다시 확인", "심사용 로그아웃"]);
  assert.deepEqual(delays(), [], "unknown 은 저절로 다시 읽지 않는다");

  fireEvent.click(screen.getByRole("button", { name: "결과 다시 확인" }));
  assert.equal(screen.getByRole("status").textContent, "결과를 불러오는 중이에요.");
  await settle();
  assert.deepEqual(title(), ["테스트 결제가 승인됐어요"]);
  assert.deepEqual(calls, ["GET /result", "GET /result"]);
});

test("처리 중이면 3초 뒤 다시 읽고, 승인으로 바뀌면 멈춘다", async () => {
  const calls = serveBackend({
    "GET /result": [result({ status: "processing" }), result({ status: "processing" }), result({ status: "approved" })],
  });
  await open();
  assert.deepEqual(title(), ["결제를 확인하고 있어요"]);
  assert.deepEqual(delays(), [3000]);
  await elapse();
  assert.deepEqual(delays(), [3000]);
  await elapse();
  assert.deepEqual(title(), ["테스트 결제가 승인됐어요"]);
  assert.deepEqual(delays(), []);
  assert.deepEqual(calls, ["GET /result", "GET /result", "GET /result"]);
});

test("처리 중이 끝나지 않아도 처음 읽기 뒤 20번까지만 다시 읽는다", async () => {
  const calls = serveBackend({ "GET /result": result({ status: "processing" }) });
  await open();
  for (let i = 0; i < 25 && timers.size > 0; i += 1) await elapse();
  assert.equal(calls.length, 21);
  assert.deepEqual(title(), ["결제를 확인하고 있어요"]);
  assert.deepEqual(actionNames(), ["결과 다시 확인", "심사용 로그아웃"]);
});

test("처리 중에 직접 다시 확인하면 예약된 다시 읽기를 버리고 한 번만 읽는다", async () => {
  const calls = serveBackend({
    "GET /result": [result({ status: "processing" }), result({ status: "approved" })],
  });
  await open();
  assert.deepEqual(delays(), [3000]);
  fireEvent.click(screen.getByRole("button", { name: "결과 다시 확인" }));
  await settle();
  assert.deepEqual(delays(), []);
  assert.deepEqual(calls, ["GET /result", "GET /result"]);
  assert.deepEqual(title(), ["테스트 결제가 승인됐어요"]);
});

test("심사용 세션이 없으면(401·403) 다시 로그인하라고 안내한다", async () => {
  for (const status of [401, 403]) {
    serveBackend({ "GET /result": json(status, { detail: "pg_review_login_required" }) });
    await open();
    assert.match(window.document.body.textContent, /심사용 로그인이 끝났어요\. 결과를 보려면 다시 로그인해 주세요\./);
    assert.equal(screen.getByRole("link", { name: "로그인 화면으로" }).getAttribute("href"), "/pg-review");
    cleanup();
  }
});

test("결과를 못 읽으면 다시 불러오기를 보이고, 시작 전 상태면 처음 화면으로 안내한다", async () => {
  const calls = serveBackend({
    "GET /result": [json(500, { detail: "internal_server_error" }), result({ status: "idle" })],
  });
  await open();
  const failure = screen.getByRole("alert");
  assert.equal(failure.textContent, "결과를 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.다시 불러오기");
  fireEvent.click(screen.getByRole("button", { name: "다시 불러오기" }));
  await settle();
  assert.deepEqual(title(), ["진행 중인 테스트 결제가 없어요"]);
  assert.deepEqual(actionNames(), ["심사용 로그아웃", "처음 화면으로"]);
  assert.deepEqual(calls, ["GET /result", "GET /result"]);
});

test("심사용 로그아웃은 서버에 알리고 다시 로그인하라는 안내로 바뀐다", async () => {
  const calls = serveBackend({
    "GET /result": result({ status: "approved" }),
    "POST /logout": new Response(null, { status: 204 }),
  });
  await open();
  fireEvent.click(screen.getByRole("button", { name: "심사용 로그아웃" }));
  await settle();
  assert.deepEqual(calls, ["GET /result", "POST /logout"]);
  assert.equal(screen.getByRole("link", { name: "로그인 화면으로" }).getAttribute("href"), "/pg-review");
});
