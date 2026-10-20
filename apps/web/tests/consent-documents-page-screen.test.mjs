// 동의 문서 공개 페이지(/terms, account.consent) 화면. 누구에게나 동의 문서의 현재 판 전문과
// 개인정보 처리방침(고지) 전문을 보여 주고 결정 버튼이 없다. 둘 중 하나라도 못 받으면 반쪽
// 페이지를 그리지 않고 다시 시도하게 한다. 받아 오는 순수한 부분은 consent-documents-page.test.mjs 가 본다.
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import "./ts-module-loader.mjs";
import { react } from "./mount-probe.mjs";

process.env.NEXT_PUBLIC_API_BASE_URL = "";

const { act, cleanup, render, screen, within, fireEvent } = await import("@testing-library/react");
const { ConsentDocumentsPage } = await import(
  "../src/features/consent/consent-documents-page.tsx"
);
const { clearTokens, hasGuestSession } = await import("../src/lib/auth/token-store.ts");

const originalFetch = globalThis.fetch;

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const terms = {
  id: "0f0e0d0c-0b0a-4908-8706-050403020100",
  type: "terms",
  version: "v1",
  title: "서비스 이용약관",
  body: "# 이용약관\n\n제1조 목적",
  required: true,
  published_at: "2026-09-01T00:00:00.000000Z",
};

const marketing = {
  id: "1f0e0d0c-0b0a-4908-8706-050403020100",
  type: "marketing_email",
  version: "v3",
  title: "광고성 정보 수신 동의 (이메일)",
  body: "업데이트 소식을 메일로 보내요.",
  required: false,
  // 서버가 시각 모양이 아닌 값을 주면 지어내지 않고 그대로 보인다.
  published_at: "곧 시행",
};

const privacyPolicy = {
  type: "privacy_policy",
  title: "개인정보 처리방침",
  body: "수탁사와 위탁 업무를 적어요.",
};

/** 경로마다 차례로 줄 응답을 두고, 온 요청을 적는다. */
function serve(routes) {
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const path = new URL(String(input), "http://web.test").pathname;
    calls.push(`${init.method ?? "GET"} ${path}`);
    const queue = routes[path];
    if (!queue?.length) throw new Error(`예상하지 못한 요청: ${path}`);
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

test("account.consent: 동의 문서마다 필수·선택, 판, 시행일과 전문을 보여 주고 처리방침 고지는 판 없이 싣는다", async () => {
  const calls = serve({
    "/v2/consents/documents": [() => jsonResponse({ documents: [terms, marketing] })],
    "/v2/consents/notices": [() => jsonResponse({ notices: [privacyPolicy] })],
  });

  render(react.createElement(ConsentDocumentsPage));
  assert.ok(screen.getByRole("heading", { level: 1, name: "동의 문서를 불러오고 있어요" }));
  assert.ok(screen.getByText("필요한 문서를 불러오는 중이에요."));
  await settle();

  assert.ok(screen.getByRole("heading", { level: 1, name: "동의 문서" }));
  assert.ok(
    screen.getByText("지금 적용 중인 동의 문서와 개인정보 처리방침을 확인할 수 있어요."),
  );
  const cards = screen.getAllByRole("article");
  assert.equal(cards.length, 3);

  const [termsCard, marketingCard, noticeCard] = cards;
  assert.ok(within(termsCard).getByText("필수 동의"));
  assert.ok(within(termsCard).getByRole("heading", { level: 2, name: "서비스 이용약관" }));
  assert.ok(within(termsCard).getByRole("heading", { level: 3, name: "이용약관" }));
  assert.ok(within(termsCard).getByText("제1조 목적"));
  assert.ok(within(termsCard).getByText("버전 v1"));
  // 발행 시각이 곧 시행일이다. 한국 시간으로 읽는다.
  assert.ok(within(termsCard).getByText("시행일 2026년 9월 1일"));

  assert.ok(within(marketingCard).getByText("선택 동의"));
  assert.ok(within(marketingCard).getByText("버전 v3"));
  assert.ok(within(marketingCard).getByText("시행일 곧 시행"));

  assert.ok(within(noticeCard).getByText("안내"));
  assert.ok(within(noticeCard).getByRole("heading", { level: 2, name: "개인정보 처리방침" }));
  assert.ok(within(noticeCard).getByText("수탁사와 위탁 업무를 적어요."));
  assert.equal(within(noticeCard).queryByText(/버전|시행일/), null);

  // 열람용이다. 결정 버튼이 없고, 이 페이지 때문에 게스트가 생기지도 않는다.
  assert.deepEqual(screen.queryAllByRole("button"), []);
  assert.deepEqual(calls.sort(), ["GET /v2/consents/documents", "GET /v2/consents/notices"]);
  assert.equal(hasGuestSession(), false);
});

test("account.consent: 공개된 동의 문서가 없으면 그렇게 알리고 처리방침 고지는 그대로 보인다", async () => {
  serve({
    "/v2/consents/documents": [() => jsonResponse({ documents: [] })],
    "/v2/consents/notices": [() => jsonResponse({ notices: [privacyPolicy] })],
  });

  render(react.createElement(ConsentDocumentsPage));
  await settle();

  assert.ok(screen.getByText("현재 공개된 동의 문서가 없어요."));
  assert.deepEqual(
    screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent),
    ["개인정보 처리방침"],
  );
});

test("account.consent: 하나라도 못 받으면 반쪽 페이지 대신 오류를 보여 주고, 다시 시도하면 다시 받는다", async () => {
  const calls = serve({
    "/v2/consents/documents": [() => jsonResponse({ documents: [terms] })],
    "/v2/consents/notices": [
      () => jsonResponse({ detail: "internal_server_error" }, 500),
      () => jsonResponse({ notices: [privacyPolicy] }),
    ],
  });

  render(react.createElement(ConsentDocumentsPage));
  await settle();

  assert.ok(screen.getByRole("heading", { level: 1, name: "동의 문서를 불러오지 못했어요" }));
  assert.equal(screen.getByRole("alert").textContent, "잠시 뒤 다시 시도해 주세요.");
  assert.equal(screen.queryByRole("article"), null);

  fireEvent.click(screen.getByRole("button", { name: "다시 시도하기" }));
  await settle();

  assert.ok(screen.getByRole("heading", { level: 1, name: "동의 문서" }));
  assert.deepEqual(
    screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent),
    ["서비스 이용약관", "개인정보 처리방침"],
  );
  assert.equal(calls.filter((call) => call === "GET /v2/consents/notices").length, 2);
});
