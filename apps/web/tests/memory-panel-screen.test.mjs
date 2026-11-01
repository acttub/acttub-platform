// practice.memory — 코치가 기억하는 것(/memory). 배우가 틀린 기억을 되돌리는 유일한 자리라, 화면을 실제로 그려
// 서버 응답이 칸마다 어떻게 보이는지, 고치기·지우기·전부 지우기가 어떤 요청을 보내고 화면을 어떻게 바꾸는지 본다.
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import "./ts-module-loader.mjs";
import { react, window } from "./mount-probe.mjs";
import "./fixtures/features-next-shims.mjs";

process.env.NEXT_PUBLIC_API_BASE_URL = "";

const { act, cleanup, fireEvent, render, screen, waitFor, within } = await import("@testing-library/react");
const { MemoryPanel } = await import("../src/features/memory/memory-panel.tsx");
const { clearTokens, hasGuestSession, setTokens } = await import("../src/lib/auth/token-store.ts");

const h = react.createElement;
const originalFetch = globalThis.fetch;
const originalConfirm = window.confirm;

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
}

/** "METHOD /path" 마다 응답을 주고, 온 요청을 적어 둔다. 응답 함수는 Promise 를 돌려 답을 미룰 수 있다. */
function serve(routes) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const route = `${init.method ?? "GET"} ${String(url)}`;
    calls.push({ route, body: init.body === undefined ? undefined : JSON.parse(init.body), signal: init.signal });
    const respond = routes[route];
    if (!respond) throw new Error(`예상하지 못한 요청: ${route}`);
    return respond();
  };
  return calls;
}

const item = (field, value, overrides = {}) => ({
  field,
  value,
  written_by_actor: false,
  source_practice_id: null,
  updated_at: "2026-09-21T00:00:00Z",
  ...overrides,
});

/** 칸 이름(h2)으로 그 칸의 section 을 찾는다. */
const section = (label) => screen.getByRole("heading", { level: 2, name: label }).closest("section");
const field = (label) => within(section(label));

function startGuest() {
  setTokens({ access_token: "guest-access", refresh_token: "guest-refresh" });
}

let confirms;
function answerConfirm(answer) {
  window.confirm = (message) => {
    confirms.push(message);
    return answer;
  };
}

beforeEach(() => {
  confirms = [];
  clearTokens();
});

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  window.confirm = originalConfirm;
  clearTokens();
});

test("practice.memory: 게스트가 없으면 서버에 묻지 않고 다섯 칸을 빈 상태로 그린다", () => {
  const calls = serve({});
  render(h(MemoryPanel));

  assert.equal(screen.getByRole("heading", { level: 1 }).textContent, "코치가 기억하는 것");
  assert.equal(screen.getByText("아직 적힌 게 없어요").tagName, "P");
  assert.equal(screen.getByText("성별·나이는 앱으로 옮기면 프로필에서 적어요").tagName, "P");
  assert.deepEqual(
    screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent),
    ["목표", "자주 막히는 지점", "코치에게 바라는 것", "자주 짚인 버릇", "다시 말하지 않을 것"],
  );
  assert.equal(screen.getAllByText("비어 있음").length, 5);
  assert.equal(screen.queryByRole("button", { name: "지우기" }), null);
  assert.equal(screen.queryByRole("button", { name: "기억 전부 지우기" }), null);
  assert.equal(screen.getByRole("link", { name: "← 연습으로" }).getAttribute("href"), "/home");
  assert.deepEqual(calls, []);
  assert.equal(hasGuestSession(), false);
});

test("practice.memory: 칸마다 누가 적었는지와 코치가 적은 말의 출처 연습을 보인다", async () => {
  startGuest();
  serve({
    "GET /v2/me/memory": () =>
      jsonResponse({
        items: [
          item("goal", "입시에서 자유연기로 붙기", { written_by_actor: true }),
          item("blockage", "말끝이 흐려진다", { source_practice_id: "p 1" }),
          item("habits", "고개를 먼저 돌린다"),
        ],
      }),
  });
  render(h(MemoryPanel));

  assert.equal(screen.getByText("불러오는 중…").tagName, "P");
  await screen.findByText("내가 적은 값");

  assert.equal(screen.queryByText("아직 적힌 게 없어요"), null);
  assert.equal(field("목표").getByRole("textbox", { name: "목표" }).value, "입시에서 자유연기로 붙기");
  assert.equal(field("목표").queryByRole("link", { name: "이 말이 나온 연습 보기" }), null);
  assert.equal(field("자주 막히는 지점").getByText("코치가 적음").tagName, "SPAN");
  assert.equal(
    field("자주 막히는 지점").getByRole("link", { name: "이 말이 나온 연습 보기" }).getAttribute("href"),
    "/home?session=p%201",
  );
  // 출처 연습이 숨겨졌으면 값은 그대로고 링크만 없다.
  assert.equal(field("자주 짚인 버릇").getByText("코치가 적음").tagName, "SPAN");
  assert.equal(field("자주 짚인 버릇").queryByRole("link"), null);
  assert.equal(field("코치에게 바라는 것").getByText("비어 있음").tagName, "SPAN");
  // 고치지 않은 칸은 저장할 것이 없다.
  assert.equal(field("목표").getByRole("button", { name: "저장" }).disabled, true);
  assert.equal(screen.getByRole("button", { name: "기억 전부 지우기" }).tagName, "BUTTON");
});

test("practice.memory: 고친 칸을 저장하면 다듬은 값을 PUT 하고, 저장하는 동안과 저장 뒤를 버튼이 말한다", async () => {
  startGuest();
  let answerSave;
  const calls = serve({
    "GET /v2/me/memory": () => jsonResponse({ items: [item("goal", "입시 합격")] }),
    "PUT /v2/me/memory/goal": () => new Promise((resolve) => {
      answerSave = () => resolve(jsonResponse(item("goal", "자유연기로 붙기", { written_by_actor: true })));
    }),
  });
  render(h(MemoryPanel));
  await screen.findByText("코치가 적음");

  const textbox = field("목표").getByRole("textbox", { name: "목표" });
  fireEvent.change(textbox, { target: { value: "   " } });
  assert.equal(field("목표").getByRole("button", { name: "저장" }).disabled, true);

  fireEvent.change(textbox, { target: { value: "  자유연기로 붙기  " } });
  fireEvent.click(field("목표").getByRole("button", { name: "저장" }));

  const saving = await field("목표").findByRole("button", { name: "저장 중" });
  assert.equal(saving.disabled, true);
  await act(async () => answerSave());

  await field("목표").findByRole("button", { name: "저장됨" });
  assert.equal(field("목표").getByText("내가 적은 값").tagName, "SPAN");
  assert.deepEqual(calls.at(-1), { route: "PUT /v2/me/memory/goal", body: { value: "자유연기로 붙기" }, signal: undefined });
  assert.equal(screen.queryByRole("alert"), null);

  // 잠깐 "저장됨" 을 보인 뒤 원래 이름으로 돌아온다.
  await field("목표").findByRole("button", { name: "저장" }, { timeout: 2500 });
});

test("practice.memory: 저장에 실패하면 고친 글을 둔 채 다시 시도하라고 알린다", async () => {
  startGuest();
  serve({
    "GET /v2/me/memory": () => jsonResponse({ items: [] }),
    "PUT /v2/me/memory/wants": () => jsonResponse({ detail: "internal_error" }, 500),
  });
  render(h(MemoryPanel));
  await screen.findByText("아직 적힌 게 없어요");

  fireEvent.change(field("코치에게 바라는 것").getByRole("textbox"), { target: { value: "표정 위주로" } });
  fireEvent.click(field("코치에게 바라는 것").getByRole("button", { name: "저장" }));

  assert.equal((await screen.findByRole("alert")).textContent, "저장하지 못했어요. 잠시 후 다시 시도해 주세요.");
  assert.equal(field("코치에게 바라는 것").getByRole("textbox").value, "표정 위주로");
  assert.equal(field("코치에게 바라는 것").getByRole("button", { name: "저장" }).disabled, false);
});

test("practice.memory: 게스트 없이 적어 저장하면 그때 게스트가 생기고, 뒤이은 조회가 아직 저장하지 않은 글을 덮지 않는다", async () => {
  const calls = serve({
    "POST /v2/auth/guest": () =>
      jsonResponse({ access_token: "new-access", refresh_token: "new-refresh", user: { id: "g-1", email: null, status: "active" } }, 201),
    "PUT /v2/me/memory/goal": () => jsonResponse(item("goal", "자유연기로 붙기", { written_by_actor: true })),
    "GET /v2/me/memory": () =>
      jsonResponse({ items: [item("avoid", "서버에 있던 말")] }),
  });
  render(h(MemoryPanel));

  fireEvent.change(field("다시 말하지 않을 것").getByRole("textbox"), { target: { value: "아직 저장 안 한 말" } });
  fireEvent.change(field("목표").getByRole("textbox"), { target: { value: "자유연기로 붙기" } });
  fireEvent.click(field("목표").getByRole("button", { name: "저장" }));

  await waitFor(() => assert.equal(calls.length, 3));
  // 게스트가 생기는 순간 조회가 함께 출발한다. 저장과 조회의 순서는 정해져 있지 않다.
  assert.deepEqual(calls.map(({ route }) => route).sort(), ["GET /v2/me/memory", "POST /v2/auth/guest", "PUT /v2/me/memory/goal"]);
  await field("다시 말하지 않을 것").findByText("코치가 적음");
  assert.equal(field("다시 말하지 않을 것").getByRole("textbox").value, "아직 저장 안 한 말");
  assert.equal(field("목표").getByText("내가 적은 값").tagName, "SPAN");
  assert.equal(hasGuestSession(), true);
});

test("practice.memory: 칸 하나 지우기는 확인을 받은 뒤 그 칸만 DELETE 하고 비운다", async () => {
  startGuest();
  const calls = serve({
    "GET /v2/me/memory": () => jsonResponse({ items: [item("goal", "입시 합격"), item("blockage", "말끝")] }),
    "DELETE /v2/me/memory/blockage": () => new Response(null, { status: 204 }),
  });
  render(h(MemoryPanel));
  await screen.findAllByText("코치가 적음");

  answerConfirm(false);
  fireEvent.click(field("자주 막히는 지점").getByRole("button", { name: "지우기" }));
  assert.deepEqual(confirms, ["'자주 막히는 지점'을 지울까요? 코치가 다음 연습에서 이 내용을 참고하지 않게 됩니다."]);
  assert.equal(calls.length, 1);

  answerConfirm(true);
  fireEvent.click(field("자주 막히는 지점").getByRole("button", { name: "지우기" }));

  await field("자주 막히는 지점").findByText("비어 있음");
  assert.equal(field("자주 막히는 지점").getByRole("textbox").value, "");
  assert.equal(field("자주 막히는 지점").queryByRole("button", { name: "지우기" }), null);
  assert.equal(field("목표").getByRole("textbox").value, "입시 합격");
  assert.deepEqual(calls.map(({ route }) => route), ["GET /v2/me/memory", "DELETE /v2/me/memory/blockage"]);
});

test("practice.memory: 칸 하나를 지우지 못하면 그 칸을 그대로 두고 알린다", async () => {
  startGuest();
  serve({
    "GET /v2/me/memory": () => jsonResponse({ items: [item("goal", "입시 합격")] }),
    "DELETE /v2/me/memory/goal": () => jsonResponse({ detail: "internal_error" }, 500),
  });
  render(h(MemoryPanel));
  await screen.findByText("코치가 적음");

  answerConfirm(true);
  fireEvent.click(field("목표").getByRole("button", { name: "지우기" }));

  assert.equal((await screen.findByRole("alert")).textContent, "지우지 못했어요. 잠시 후 다시 시도해 주세요.");
  assert.equal(field("목표").getByRole("textbox").value, "입시 합격");
});

test("practice.memory: 전부 지우기는 되돌릴 수 없다고 묻고, 지우면 빈 화면으로 돌아간다", async () => {
  startGuest();
  const calls = serve({
    "GET /v2/me/memory": () => jsonResponse({ items: [item("goal", "입시 합격"), item("habits", "고개를 돌린다")] }),
    "DELETE /v2/me/memory": () => new Response(null, { status: 204 }),
  });
  render(h(MemoryPanel));
  await screen.findAllByText("코치가 적음");

  answerConfirm(false);
  fireEvent.click(screen.getByRole("button", { name: "기억 전부 지우기" }));
  assert.deepEqual(confirms, ["기억을 전부 지울까요? 코치가 나에 대해 알던 것이 모두 사라집니다. 되돌릴 수 없어요."]);
  assert.equal(calls.length, 1);

  answerConfirm(true);
  fireEvent.click(screen.getByRole("button", { name: "기억 전부 지우기" }));

  await screen.findByText("아직 적힌 게 없어요");
  assert.equal(screen.getAllByText("비어 있음").length, 5);
  assert.equal(field("목표").getByRole("textbox").value, "");
  assert.equal(screen.queryByRole("button", { name: "기억 전부 지우기" }), null);
  assert.deepEqual(calls.map(({ route }) => route), ["GET /v2/me/memory", "DELETE /v2/me/memory"]);
});

test("practice.memory: 전부 지우기에 실패하면 기억을 그대로 보이고 알린다", async () => {
  startGuest();
  serve({
    "GET /v2/me/memory": () => jsonResponse({ items: [item("goal", "입시 합격")] }),
    "DELETE /v2/me/memory": () => jsonResponse({ detail: "internal_error" }, 500),
  });
  render(h(MemoryPanel));
  await screen.findByText("코치가 적음");

  answerConfirm(true);
  fireEvent.click(screen.getByRole("button", { name: "기억 전부 지우기" }));

  assert.equal((await screen.findByRole("alert")).textContent, "지우지 못했어요. 잠시 후 다시 시도해 주세요.");
  assert.equal(field("목표").getByRole("textbox").value, "입시 합격");
});

test("practice.memory: 불러오지 못하면 빈 상태와 구분되게 알린다", async () => {
  startGuest();
  serve({ "GET /v2/me/memory": () => jsonResponse({ detail: "internal_error" }, 500) });
  render(h(MemoryPanel));

  assert.equal((await screen.findByRole("alert")).textContent, "지금은 불러오지 못했어요. 잠시 후 새로고침해 주세요.");
  assert.equal(screen.queryByText("불러오는 중…"), null);
});

test("practice.memory: 답을 받기 전에 화면을 떠나면 조회를 끊고 오류를 그리지 않는다", async () => {
  startGuest();
  const calls = serve({
    "GET /v2/me/memory": () => new Promise((_, reject) => {
      calls[0].signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }),
  });
  const view = render(h(MemoryPanel));
  await waitFor(() => assert.equal(calls.length, 1));

  view.unmount();

  assert.equal(calls[0].signal.aborted, true);
  await act(async () => {});
  assert.equal(window.document.body.textContent, "");
});
