// billing.pg-review 심사용 결제 화면(/pg-review). 설정 확인 → 심사용 로그인 → 필수 확인 세 개 → 토스 결제창 순서를
// 실제로 그리고 눌러 본다. 서버는 fetch 대역, 토스 SDK 는 window.TossPayments 대역이다.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { afterEach, beforeEach, test } from "node:test";

import "./ts-module-loader.mjs";
import { react, window } from "./mount-probe.mjs";
import { deferred, json, serveBackend } from "./fixtures/pg-review-backend.mjs";

// Next의 Node ESM 하위 경로만 확장한다. Link 자체는 실제 컴포넌트다.
registerHooks({
  resolve(specifier, context, next) {
    return next(specifier === "next/link" ? "next/link.js" : specifier, context);
  },
});
globalThis.self = window;

const { cleanup, fireEvent, render, screen, within } = await import("@testing-library/react");
const { PgReviewApp } = await import("../src/features/pg-review/pg-review-app.tsx");

const ORIGIN = window.location.origin;
const SDK_URL = "https://js.tosspayments.com/v2/standard";
const START = "카드 등록하고 테스트 결제하기";
const CHECKOUT = {
  clientKey: "test_ck_abc",
  customerKey: "cust-1",
  successUrl: `${ORIGIN}/v2/pg-review/success?state=s1`,
  failUrl: `${ORIGIN}/v2/pg-review/fail?state=s1`,
};
const SIGNED_IN = { available: true, authenticated: true, testOnly: true, amount: 3900 };
const SIGNED_OUT = { ...SIGNED_IN, authenticated: false };

const realFetch = globalThis.fetch;
let toss;

/**
 * 토스 SDK 대역. 받은 값을 차례로 남긴다. 진짜 SDK 는 성공하면 페이지를 토스로 옮기므로, 기본 대역은
 * 옮기지 않고 끝나기만 한다. 실패는 테스트가 정한다.
 */
function installToss(requestBillingAuth = async () => {}) {
  const seen = [];
  window.TossPayments = (clientKey) => {
    seen.push({ clientKey });
    return {
      payment: ({ customerKey }) => {
        seen.push({ customerKey });
        return {
          requestBillingAuth: (request) => {
            seen.push(request);
            return requestBillingAuth();
          },
        };
      },
    };
  };
  return seen;
}

beforeEach(() => {
  toss = installToss();
});

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  delete window.TossPayments;
  for (const script of window.document.head.querySelectorAll("script")) script.remove();
});

async function settle() {
  await react.act(async () => {
    for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setImmediate(resolve));
  });
}

async function open() {
  render(react.createElement(PgReviewApp));
  await settle();
}

const button = (name) => screen.getByRole("button", { name });
/** 머리글과 심사 안내 아래, 지금 단계가 보이는 소제목들. */
const stage = () => screen.getAllByRole("heading").map((node) => node.textContent).slice(2);
const alerts = () => screen.queryAllByRole("alert").map((node) => node.textContent);

async function agreeAll() {
  for (const box of screen.getAllByRole("checkbox")) fireEvent.click(box);
  await settle();
}

test("닫힌 환경(404)이면 불러오는 중 다음에 열려 있지 않다고만 보이고 로그인 폼은 없다", async () => {
  serveBackend({ "GET /config": json(404, { detail: "not_found" }) });
  render(react.createElement(PgReviewApp));
  assert.equal(screen.getByRole("status").textContent, "불러오는 중이에요.");
  await settle();
  assert.deepEqual(stage(), ["지금은 열려 있지 않아요"]);
  assert.equal(screen.queryByLabelText("아이디"), null);
});

test("설정을 못 읽으면 문구와 다시 불러오기를 보이고, 다시 물어 로그인 화면으로 간다", async () => {
  const calls = serveBackend({
    "GET /config": [json(500, { detail: "internal_server_error" }), json(200, SIGNED_OUT)],
  });
  await open();
  assert.deepEqual(alerts(), ["화면을 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.다시 불러오기"]);
  fireEvent.click(button("다시 불러오기"));
  assert.equal(screen.getByRole("status").textContent, "불러오는 중이에요.");
  await settle();
  assert.deepEqual(stage(), ["심사용 로그인"]);
  assert.deepEqual(calls, ["GET /config", "GET /config"]);
});

test("로그인은 아이디·비밀번호가 다 있어야 눌리고, 앞뒤 공백을 뺀 아이디로 한 번만 보낸 뒤 결제 단계로 간다", async () => {
  const login = deferred();
  const calls = serveBackend({
    "GET /config": json(200, SIGNED_OUT),
    "POST /login": login.promise,
  });
  await open();
  assert.equal(button("로그인").disabled, true);
  fireEvent.change(screen.getByLabelText("아이디"), { target: { value: "  reviewer " } });
  assert.equal(button("로그인").disabled, true, "비밀번호가 비어 있다");
  fireEvent.change(screen.getByLabelText("비밀번호"), { target: { value: "secret-value" } });
  assert.equal(button("로그인").disabled, false);

  fireEvent.click(button("로그인"));
  assert.equal(button("확인하는 중이에요").disabled, true);
  fireEvent.submit(button("확인하는 중이에요").closest("form"));
  login.resolve(json(200, { authenticated: true }));
  await settle();

  assert.deepEqual(calls, [
    "GET /config",
    'POST /login {"username":"reviewer","password":"secret-value"}',
  ]);
  assert.deepEqual(stage(), ["ACTTUB Pro 월 구독", "필수 확인"]);
});

test("로그인 실패는 이유별 문구를 보이고 비밀번호만 비운다", async () => {
  const cases = [
    [() => json(401, { detail: "invalid_credentials" }), "아이디나 비밀번호가 맞지 않아요."],
    [() => json(429, { detail: "rate limit exceeded" }), "시도가 너무 많아요. 잠시 뒤 다시 시도해 주세요."],
    [() => json(403, { detail: "origin_not_allowed" }), "로그인하지 못했어요. 잠시 뒤 다시 시도해 주세요."],
    [() => { throw new TypeError("fetch failed"); }, "응답을 받지 못했어요. 연결을 확인한 뒤 다시 시도해 주세요."],
  ];
  for (const [answer, message] of cases) {
    serveBackend({ "GET /config": json(200, SIGNED_OUT), "POST /login": answer });
    await open();
    fireEvent.change(screen.getByLabelText("아이디"), { target: { value: "reviewer" } });
    fireEvent.change(screen.getByLabelText("비밀번호"), { target: { value: "wrong" } });
    fireEvent.click(button("로그인"));
    await settle();
    assert.deepEqual(alerts(), [message]);
    assert.equal(screen.getByLabelText("아이디").value, "reviewer");
    assert.equal(screen.getByLabelText("비밀번호").value, "");
    assert.equal(button("로그인").disabled, true);
    cleanup();
  }
});

test("필수 확인 셋을 다 고르면 서버가 준 키·콜백 그대로 토스 카드 등록을 연다", async () => {
  const calls = serveBackend({
    "GET /config": json(200, SIGNED_IN),
    "POST /checkout": json(200, CHECKOUT),
  });
  await open();
  const boxes = screen.getAllByRole("checkbox");
  assert.equal(boxes.length, 3);
  fireEvent.click(boxes[0]);
  fireEvent.click(boxes[1]);
  assert.equal(button(START).disabled, true, "셋 중 둘만 골랐다");
  fireEvent.click(boxes[2]);
  assert.equal(button(START).disabled, false);

  const start = button(START);
  react.act(() => {
    start.click();
    start.click();
  });
  await settle();

  assert.deepEqual(calls, ["GET /config", "POST /checkout"], "빠른 두 번 누름도 주문은 하나다");
  assert.deepEqual(toss, [
    { clientKey: "test_ck_abc" },
    { customerKey: "cust-1" },
    { method: "CARD", successUrl: CHECKOUT.successUrl, failUrl: CHECKOUT.failUrl },
  ]);
  assert.equal(button("결제창으로 이동하는 중이에요").disabled, true, "토스로 옮겨 가기 전까지 잠가 둔다");
  assert.equal(button("결제창으로 이동하는 중이에요").getAttribute("aria-busy"), "true");
});

test("토스 화면에서 뒤로 가기로 복원된 페이지만 이동 중 잠금을 푼다", async () => {
  serveBackend({ "GET /config": json(200, SIGNED_IN), "POST /checkout": json(200, CHECKOUT) });
  await open();
  await agreeAll();
  fireEvent.click(button(START));
  await settle();

  const pageshow = (persisted) =>
    react.act(() => {
      window.dispatchEvent(new window.PageTransitionEvent("pageshow", { persisted }));
    });
  pageshow(false);
  assert.equal(button("결제창으로 이동하는 중이에요").disabled, true);
  pageshow(true);
  assert.equal(button(START).disabled, false);
});

test("서버가 준 결제 값이 테스트 키·같은 출처가 아니면 토스를 부르지 않고 중단 문구를 보인다", async () => {
  serveBackend({
    "GET /config": json(200, SIGNED_IN),
    "POST /checkout": json(200, { ...CHECKOUT, clientKey: "live_ck_abc" }),
  });
  await open();
  await agreeAll();
  fireEvent.click(button(START));
  await settle();
  assert.deepEqual(alerts(), ["결제 준비 값이 올바르지 않아 중단했어요. 잠시 뒤 처음부터 다시 시도해 주세요."]);
  assert.deepEqual(toss, []);
  assert.equal(button(START).disabled, false);
});

test("결제창을 사용자가 닫으면 조용히 되돌리고, 다른 실패는 문구를 보인다", async () => {
  let outcome = { code: "USER_CANCEL", message: "취소되었습니다." };
  toss = installToss(() => Promise.reject(outcome));
  serveBackend({ "GET /config": json(200, SIGNED_IN), "POST /checkout": json(200, CHECKOUT) });
  await open();
  await agreeAll();

  fireEvent.click(button(START));
  await settle();
  assert.deepEqual(alerts(), []);
  assert.equal(button(START).disabled, false);

  outcome = { code: "INVALID_CARD_COMPANY", message: "Invalid card company" };
  fireEvent.click(button(START));
  await settle();
  assert.deepEqual(alerts(), ["결제창을 열지 못했어요. 잠시 뒤 다시 시도해 주세요."]);
  assert.equal(toss.filter((entry) => entry.method === "CARD").length, 2);
});

test("결제 준비가 거절(409)되면 문구를 보이고, 심사용 세션이 끝났으면(401) 로그인으로 돌아간다", async () => {
  serveBackend({
    "GET /config": json(200, SIGNED_IN),
    "POST /checkout": [
      json(409, { detail: "checkout_not_allowed" }),
      json(401, { detail: "pg_review_login_required" }),
    ],
  });
  await open();
  await agreeAll();
  fireEvent.click(button(START));
  await settle();
  assert.deepEqual(alerts(), ["결제창을 열지 못했어요. 잠시 뒤 다시 시도해 주세요."]);

  fireEvent.click(button(START));
  await settle();
  assert.deepEqual(stage(), ["심사용 로그인"]);
  assert.deepEqual(toss, []);
});

test("SDK 스크립트를 못 받으면 결제 버튼을 잠근 채 다시 불러오기를 보이고, 다시 받으면 결제할 수 있다", async () => {
  const factory = window.TossPayments;
  delete window.TossPayments;
  serveBackend({ "GET /config": json(200, SIGNED_IN) });
  await open();
  await agreeAll();
  assert.equal(button("결제창 준비 중이에요").disabled, true);

  const first = window.document.head.querySelector(`script[src="${SDK_URL}"]`);
  react.act(() => {
    first.dispatchEvent(new window.Event("error"));
  });
  await settle();
  const failure = screen.getByRole("alert");
  assert.equal(
    failure.textContent,
    "결제창 구성요소를 불러오지 못했어요. 연결을 확인한 뒤 다시 불러와 주세요. 다시 불러오기",
  );
  assert.equal(button(START).disabled, true);

  fireEvent.click(within(failure).getByRole("button", { name: "다시 불러오기" }));
  assert.equal(button("결제창 준비 중이에요").disabled, true);
  const second = window.document.head.querySelector(`script[src="${SDK_URL}"]`);
  assert.notEqual(second, first);
  window.TossPayments = factory;
  react.act(() => {
    second.dispatchEvent(new window.Event("load"));
  });
  await settle();
  assert.deepEqual(alerts(), []);
  assert.equal(button(START).disabled, false);
});

test("심사용 로그아웃은 서버에 알리고 로그인 화면으로 돌아간다", async () => {
  const calls = serveBackend({
    "GET /config": json(200, SIGNED_IN),
    "POST /logout": new Response(null, { status: 204 }),
  });
  await open();
  fireEvent.click(button("심사용 로그아웃"));
  await settle();
  assert.deepEqual(calls, ["GET /config", "POST /logout"]);
  assert.deepEqual(stage(), ["심사용 로그인"]);
});
