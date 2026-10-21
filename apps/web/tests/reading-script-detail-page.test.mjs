// reading.script·reading.session — 대본 상세(/reading/scripts/<id>). 주소에서 id 를 읽어 대본과 회차 목록을 받고,
// 이어서 연습·새로운 연습·암기하기·회차 지우기를 잇는다.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { afterEach, beforeEach, test } from "node:test";

import "./ts-module-loader.mjs";
import { react, window } from "./mount-probe.mjs";

process.env.NEXT_PUBLIC_API_BASE_URL = "";
globalThis.sessionStorage = window.sessionStorage;

const stubs = new URL("./fixtures/reading-page-stubs.mjs", import.meta.url).href;
const replaced = new Set(["next/navigation", "next/link", "@/features/nav/app-rail", "@/features/reading/screens/SessionRecordings"]);
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (replaced.has(specifier)) return { url: stubs, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const { nav } = await import("./fixtures/reading-page-stubs.mjs");
const { act, cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const { ScriptDetailPage } = await import("../src/features/reading/pages/script-detail-page.tsx");
const { clearTokens, setTokens } = await import("../src/lib/auth/token-store.ts");

const detail = (overrides = {}) => ({
  id: "script-1",
  title: "갈매기",
  source: "paste",
  raw_text: "",
  characters: [
    { id: "c-nina", name: "니나", order: 0, voice_preset: null, voice: "F1", dialogue_count: 2 },
    { id: "c-kostya", name: "트레플레프", order: 1, voice_preset: null, voice: "M2", dialogue_count: 1 },
  ],
  lines: [
    { id: "l-0", ordinal: 0, kind: "dialogue", character_id: "c-nina", text: "나는 갈매기.", dialogue_no: 1 },
    { id: "l-1", ordinal: 1, kind: "dialogue", character_id: "c-kostya", text: "아니, 너는 배우야.", dialogue_no: 2 },
    { id: "l-2", ordinal: 2, kind: "dialogue", character_id: "c-nina", text: "그래, 배우.", dialogue_no: 3 },
  ],
  recording_count: 0,
  open_session_id: null,
  last_session: null,
  created_at: "2026-10-01T03:00:00Z",
  updated_at: "2026-10-01T03:00:00Z",
  ...overrides,
});

const card = (overrides = {}) => ({
  id: "session-1",
  ordinal: 1,
  status: "completed",
  my_character_ids: ["c-nina"],
  my_character_names: ["니나"],
  range: { start_line_id: "l-0", end_line_id: "l-2" },
  range_name: "full",
  progress: null,
  my_dialogue_count: 2,
  recorded_line_count: 2,
  elapsed_seconds: 60,
  started_at: "2026-10-01T03:00:00Z",
  ended_at: "2026-10-01T03:01:00Z",
  ...overrides,
});

const originalFetch = globalThis.fetch;
let requests;

function serve(routes) {
  requests = [];
  globalThis.fetch = async (url, init = {}) => {
    const route = `${init.method ?? "GET"} ${String(url)}`;
    requests.push(route);
    const answer = routes[route];
    if (!answer) return json({ code: "not_found", message: "없음" }, 404);
    const [payload, status] = typeof answer === "function" ? answer() : answer;
    return status === 204 ? new Response(null, { status }) : json(payload, status);
  };
}

const json = (payload, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });

const flush = () => act(async () => {
  await new Promise((r) => setTimeout(r, 0));
});

async function open(path = "/reading/scripts/script-1") {
  window.history.replaceState(null, "", path);
  render(react.createElement(ScriptDetailPage));
  await flush();
  await flush();
}

const GET_SCRIPT = "GET /v2/reading/scripts/script-1";
const GET_SESSIONS = "GET /v2/reading/scripts/script-1/sessions";

beforeEach(() => {
  window.sessionStorage.clear();
  nav.pushed.length = 0;
  setTokens({ access_token: "guest-access", refresh_token: "guest-refresh" });
});

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  clearTokens();
});

test("reading.script: 대본과 회차 목록을 받아 배역별 대사 수와 회차 카드를 보인다", async () => {
  serve({ [GET_SCRIPT]: [detail()], [GET_SESSIONS]: [{ sessions: [card()] }] });
  await open();

  assert.equal(screen.getByText("니나").textContent, "니나2줄");
  assert.equal(screen.getByText("트레플레프").textContent, "트레플레프1줄");
  screen.getByText("회차 1개 · 최근순");
  screen.getByText(/^1회차/);
  assert.equal(screen.queryByRole("button", { name: /이어서 연습/ }), null);
});

test("reading.script: 회차가 없으면 새로운 연습으로 시작하라고 안내한다", async () => {
  serve({ [GET_SCRIPT]: [detail()], [GET_SESSIONS]: [{ sessions: [] }] });
  await open();
  screen.getByText("아직 회차가 없어요. 새로운 연습으로 시작해요.");
});

test("reading.script: 주소에 대본 id 가 없거나 게스트 세션이 없으면 찾을 수 없다고 보이고 목록으로 돌아간다", async () => {
  serve({});
  await open("/reading/scripts");
  screen.getByText("대본을 찾을 수 없어요. 목록에서 다시 골라 주세요.");
  fireEvent.click(screen.getByRole("button", { name: "대본 목록으로" }));
  assert.deepEqual(nav.pushed, ["/reading"]);
  assert.deepEqual(requests, []);
  cleanup();

  clearTokens();
  await open();
  screen.getByText("대본을 찾을 수 없어요. 목록에서 다시 골라 주세요.");
  assert.deepEqual(requests, []);
});

test("reading.script: 대본을 받지 못하면 서버 오류 문구를 보인다", async () => {
  serve({ [GET_SCRIPT]: [{ code: "not_found", message: "없음" }, 404], [GET_SESSIONS]: [{ sessions: [] }] });
  await open();
  assert.equal(screen.queryByText("새로운 연습"), null);
  screen.getByRole("button", { name: "대본 목록으로" });
});

test("reading.session: 이어서 연습은 회차를 다시 받아 그 진행으로 실행 화면을 연다", async () => {
  const fresh = { id: "session-2", script_id: "script-1", current_line_id: "l-2" };
  serve({
    [GET_SCRIPT]: [detail({ open_session_id: "session-2" })],
    [GET_SESSIONS]: [{ sessions: [card({ id: "session-2", ordinal: 2, status: "in_progress", progress: { done: 1, total: 2 } }), card()] }],
    "GET /v2/reading/sessions/session-2": [fresh],
  });
  window.sessionStorage.setItem("reading.stats", JSON.stringify({ mode: "read" }));
  await open();

  fireEvent.click(screen.getByRole("button", { name: "이어서 연습 · 1 / 2" }));
  await flush();

  assert.deepEqual(nav.pushed, ["/reading/run"]);
  assert.deepEqual(JSON.parse(window.sessionStorage.getItem("reading.session")), fresh);
  assert.equal(JSON.parse(window.sessionStorage.getItem("reading.script.v2")).id, "script-1");
  assert.equal(window.sessionStorage.getItem("reading.stats"), null);
});

test("reading.session: 이어서 연습할 회차를 열지 못하면 오류를 보이고 머문다", async () => {
  serve({
    [GET_SCRIPT]: [detail({ open_session_id: "session-2" })],
    [GET_SESSIONS]: [{ sessions: [card({ id: "session-2", status: "in_progress", progress: { done: 1, total: 2 } })] }],
    "GET /v2/reading/sessions/session-2": [{ code: "internal_error", message: "x" }, 500],
  });
  await open();

  fireEvent.click(screen.getByRole("button", { name: "이어서 연습 · 1 / 2" }));
  await flush();
  await flush();

  screen.getByText("회차를 열지 못했어요. 다시 시도해 주세요.");
  assert.deepEqual(nav.pushed, []);
  assert.equal(screen.getByRole("button", { name: "이어서 연습 · 1 / 2" }).disabled, false);
});

test("reading.session: 새로운 연습은 기기의 회차·결과를 비우고 이 대본으로 배역 화면을 연다", async () => {
  serve({ [GET_SCRIPT]: [detail()], [GET_SESSIONS]: [{ sessions: [] }] });
  window.sessionStorage.setItem("reading.session", JSON.stringify({ id: "old" }));
  await open();

  fireEvent.click(screen.getByRole("button", { name: "새로운 연습" }));

  assert.deepEqual(nav.pushed, ["/reading/setup"]);
  assert.equal(JSON.parse(window.sessionStorage.getItem("reading.script.v2")).title, "갈매기");
  assert.equal(window.sessionStorage.getItem("reading.session"), null);
});

test("reading.memorization: 암기하기는 마지막 회차의 내 배역으로, 없으면 첫 배역으로 암기 화면을 연다", async () => {
  serve({ [GET_SCRIPT]: [detail({ last_session: { my_character_ids: ["c-kostya"] } })], [GET_SESSIONS]: [{ sessions: [] }] });
  await open();
  fireEvent.click(screen.getByRole("button", { name: "암기하기" }));
  assert.deepEqual(JSON.parse(window.sessionStorage.getItem("reading.memorize")), { scriptId: "script-1", roles: ["트레플레프"], lineIds: null });
  cleanup();

  serve({ [GET_SCRIPT]: [detail()], [GET_SESSIONS]: [{ sessions: [] }] });
  await open();
  fireEvent.click(screen.getByRole("button", { name: "암기하기" }));
  assert.deepEqual(JSON.parse(window.sessionStorage.getItem("reading.memorize")), { scriptId: "script-1", roles: ["니나"], lineIds: null });
  assert.deepEqual(nav.pushed, ["/reading/memorize", "/reading/memorize"]);
});

test("reading.session: 회차를 지우면 확인 뒤 DELETE 하고 목록을 다시 받는다", async () => {
  let listed = 0;
  serve({
    [GET_SCRIPT]: [detail()],
    [GET_SESSIONS]: () => [{ sessions: listed++ === 0 ? [card()] : [] }],
    "DELETE /v2/reading/sessions/session-1": [null, 204],
  });
  await open();

  fireEvent.click(screen.getByRole("button", { name: "지우기" }));
  screen.getByText("이 회차와 녹음 2개가 지워져요. 외웠다고 표시한 것은 남아요.");
  fireEvent.click(screen.getByRole("button", { name: "취소" }));
  assert.equal(screen.queryByText(/이 회차와 녹음/), null);

  fireEvent.click(screen.getByRole("button", { name: "지우기" }));
  fireEvent.click(screen.getAllByRole("button", { name: "지우기" })[1]);
  await flush();
  await flush();

  assert.equal(requests.filter((r) => r === "DELETE /v2/reading/sessions/session-1").length, 1);
  assert.equal(requests.filter((r) => r === GET_SESSIONS).length, 2);
  screen.getByText("아직 회차가 없어요. 새로운 연습으로 시작해요.");
});

test("reading.session: 회차를 지우지 못하면 오류를 보이고 카드는 남는다", async () => {
  serve({
    [GET_SCRIPT]: [detail()],
    [GET_SESSIONS]: [{ sessions: [card()] }],
    "DELETE /v2/reading/sessions/session-1": [{ code: "internal_error", message: "x" }, 500],
  });
  await open();

  fireEvent.click(screen.getByRole("button", { name: "지우기" }));
  fireEvent.click(screen.getAllByRole("button", { name: "지우기" })[1]);
  await flush();
  await flush();

  screen.getByText(/^1회차/);
  screen.getByText("회차를 지우지 못했어요. 다시 시도해 주세요.");
  assert.equal(screen.getByRole("button", { name: "취소" }).disabled, false);
});

test("reading.session: 녹음을 펼치면 그 회차의 녹음 목록이 열리고 접기로 닫힌다", async () => {
  serve({ [GET_SCRIPT]: [detail()], [GET_SESSIONS]: [{ sessions: [card()] }] });
  await open();

  fireEvent.click(screen.getByRole("button", { name: "녹음" }));
  screen.getByRole("button", { name: "session-1 녹음 목록" });
  fireEvent.click(screen.getByRole("button", { name: "접기" }));
  assert.equal(screen.queryByRole("button", { name: "session-1 녹음 목록" }), null);
});

test("reading.session: 펼친 녹음 목록에서 녹음이 바뀌면 대본과 회차 목록을 다시 받는다", async () => {
  serve({ [GET_SCRIPT]: [detail()], [GET_SESSIONS]: [{ sessions: [card()] }] });
  await open();

  fireEvent.click(screen.getByRole("button", { name: "녹음" }));
  fireEvent.click(screen.getByRole("button", { name: "session-1 녹음 목록" }));
  await flush();
  await flush();

  assert.equal(requests.filter((r) => r === GET_SCRIPT).length, 2);
  assert.equal(requests.filter((r) => r === GET_SESSIONS).length, 2);
});

test("reading.script: 뒤로는 대본 목록으로 간다", async () => {
  serve({ [GET_SCRIPT]: [detail()], [GET_SESSIONS]: [{ sessions: [] }] });
  await open();
  fireEvent.click(screen.getAllByRole("button", { name: "뒤로" })[0]);
  assert.deepEqual(nav.pushed, ["/reading"]);
});
