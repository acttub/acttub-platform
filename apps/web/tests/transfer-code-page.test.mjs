// account.guest — 이관 코드 화면(/transfer). 웹에서 한 연습을 앱 계정으로 옮길 여섯 자리 코드를 버튼을 눌렀을 때만
// 받아 보이고, 10분이 지나면 만료로 바꾼다. 화면을 실제로 그려 버튼·코드·남은 시간·오류 문구를 본다.
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import "./ts-module-loader.mjs";
import { react } from "./mount-probe.mjs";
import "./fixtures/features-next-shims.mjs";

process.env.NEXT_PUBLIC_API_BASE_URL = "";

const { cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const { TransferCodePage } = await import("../src/features/transfer/transfer-code-page.tsx");
const { clearTokens, hasGuestSession, setTokens } = await import("../src/lib/auth/token-store.ts");

const h = react.createElement;
const originalFetch = globalThis.fetch;

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
}

function serve(...responses) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push(`${init.method ?? "GET"} ${String(url)}`);
    const next = responses.shift();
    if (!next) throw new Error(`예상하지 못한 요청: ${String(url)}`);
    return next();
  };
  return calls;
}

const codeResponse = (code, expiresIn = 600) =>
  jsonResponse({ code, expires_in: expiresIn, expires_at: "1999-01-01T00:00:00Z" }, 201);

const startGuest = () => setTokens({ access_token: "guest-access", refresh_token: "guest-refresh" });

beforeEach(() => {
  clearTokens();
});

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  clearTokens();
});

test("account.guest: 이 브라우저에 게스트가 없으면 옮길 연습이 없다고 하고 코드를 받으러 가지 않는다", () => {
  const calls = serve();
  render(h(TransferCodePage));

  assert.equal(screen.getByText("아직 옮길 연습이 없어요").tagName, "P");
  assert.equal(screen.getByRole("link", { name: "연습 시작하기" }).getAttribute("href"), "/practice/new");
  assert.equal(screen.queryByRole("button"), null);
  assert.equal(screen.getByRole("link", { name: "← 연습으로" }).getAttribute("href"), "/home");
  assert.equal(screen.getByRole("link", { name: "앱 다운로드" }).getAttribute("href"), "/app");
  assert.deepEqual(calls, []);
});

test("account.guest: 화면을 연 것만으로는 코드를 받지 않고, 버튼을 누르면 받아 세 자리씩 끊어 보인다", async () => {
  startGuest();
  let answer;
  const calls = serve(() => new Promise((resolve) => (answer = resolve)));
  render(h(TransferCodePage));

  assert.equal(screen.getByText("코드를 받으면 10분 동안 쓸 수 있어요.").tagName, "P");
  assert.deepEqual(calls, []);

  fireEvent.click(screen.getByRole("button", { name: "코드 받기" }));
  assert.equal(screen.getByRole("button", { name: "코드를 받고 있어요" }).disabled, true);
  answer(codeResponse("482913"));

  const code = await screen.findByLabelText("이관 코드 4 8 2 9 1 3");
  assert.equal(code.textContent, "482 913");
  assert.equal(screen.getByText(/^남은 시간 /).textContent, "남은 시간 10:00");
  assert.equal(screen.getByText("새 코드를 받으면 이 코드는 쓸 수 없어요.").tagName, "P");
  assert.deepEqual(calls, ["POST /v2/guest/transfer-code"]);
});

test("account.guest: 새 코드를 받으면 이전 코드 대신 새 코드를 보인다", async () => {
  startGuest();
  const calls = serve(() => codeResponse("482913"), () => codeResponse("105270"));
  render(h(TransferCodePage));
  fireEvent.click(screen.getByRole("button", { name: "코드 받기" }));
  await screen.findByLabelText("이관 코드 4 8 2 9 1 3");

  fireEvent.click(screen.getByRole("button", { name: "새 코드 받기" }));

  assert.equal((await screen.findByLabelText("이관 코드 1 0 5 2 7 0")).textContent, "105 270");
  assert.equal(screen.queryByLabelText("이관 코드 4 8 2 9 1 3"), null);
  assert.deepEqual(calls, ["POST /v2/guest/transfer-code", "POST /v2/guest/transfer-code"]);
});

test("account.guest: 남은 시간이 초마다 줄고, 다 되면 만료를 알리고 다시 받게 한다", async () => {
  startGuest();
  serve(() => codeResponse("482913", 2));
  render(h(TransferCodePage));
  fireEvent.click(screen.getByRole("button", { name: "코드 받기" }));

  assert.equal((await screen.findByText(/^남은 시간 /)).textContent, "남은 시간 0:02");
  assert.equal((await screen.findByText("남은 시간 0:01", {}, { timeout: 1500 })).tagName, "P");
  assert.equal((await screen.findByText("코드가 만료됐어요. 새 코드를 받아 주세요.", {}, { timeout: 1500 })).tagName, "P");
  assert.equal(screen.queryByLabelText(/^이관 코드/), null);
  assert.equal(screen.getByRole("button", { name: "다시 받기" }).disabled, false);
});

test("account.guest: 너무 자주 받으면 429 를 기다리라는 말로, 그 밖의 거절은 다시 시도하라는 말로 알린다", async () => {
  startGuest();
  serve(
    () => jsonResponse({ detail: "rate limit exceeded" }, 429),
    () => jsonResponse({ detail: "guest_only" }, 403),
  );
  render(h(TransferCodePage));

  fireEvent.click(screen.getByRole("button", { name: "코드 받기" }));
  assert.equal((await screen.findByRole("alert")).textContent, "잠시 뒤 다시 시도해 주세요.");

  fireEvent.click(screen.getByRole("button", { name: "코드 받기" }));
  assert.equal((await screen.findByText("코드를 받지 못했어요. 다시 시도해 주세요.")).getAttribute("role"), "alert");
  assert.equal(screen.getByRole("button", { name: "코드 받기" }).disabled, false);
});

test("account.guest: 이미 앱으로 옮겨진 게스트면 이 화면은 오류를 겹쳐 말하지 않고 옮길 연습이 없는 상태로 돌아간다", async () => {
  startGuest();
  serve(() => jsonResponse({ detail: "guest_transferred" }, 403));
  render(h(TransferCodePage));

  fireEvent.click(screen.getByRole("button", { name: "코드 받기" }));

  assert.equal((await screen.findByText("아직 옮길 연습이 없어요")).tagName, "P");
  assert.equal(screen.queryByRole("alert"), null);
  assert.equal(hasGuestSession(), false);
});
