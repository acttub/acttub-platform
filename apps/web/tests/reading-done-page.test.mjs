// reading.session — 완료 페이지(/reading/done). 기기에 든 대본·회차·결과로 완료 화면을 그리고, 다시 리딩은 같은 설정의 새 회차,
// 새 대본은 기기 캐시를 비우고 대본 넣기, 전체보기는 다시 볼 대사로 암기 화면을 연다. read 완료 응답을 받지 못했으면
// 회차 상세의 different_lines 로 다시 볼 대사를 채운다.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { afterEach, beforeEach, test } from "node:test";

import "./ts-module-loader.mjs";
import { react, window } from "./mount-probe.mjs";

process.env.NEXT_PUBLIC_API_BASE_URL = "";
globalThis.sessionStorage = window.sessionStorage;

const stubs = new URL("./fixtures/reading-page-stubs.mjs", import.meta.url).href;
const replaced = new Set(["next/navigation", "next/link", "@/features/nav/app-rail"]);
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (replaced.has(specifier)) return { url: stubs, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const { nav } = await import("./fixtures/reading-page-stubs.mjs");
const { act, cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const { DonePage } = await import("../src/features/reading/pages/done-page.tsx");
const { _resetCompletion, startCompletionRetry } = await import("../src/lib/reading/session/completion.ts");
const { clearTokens, setTokens } = await import("../src/lib/auth/token-store.ts");

const script = {
  id: "script-1",
  title: "갈매기",
  roles: ["니나", "트레플레프"],
  lines: [
    { type: "dialogue", role: "니나", text: "나는 갈매기." },
    { type: "dialogue", role: "트레플레프", text: "아니, 너는 배우야." },
    { type: "dialogue", role: "니나", text: "그래, 배우." },
  ],
  characters: [
    { id: "c-nina", name: "니나", voicePreset: null, voice: "F1" },
    { id: "c-kostya", name: "트레플레프", voicePreset: null, voice: "M2" },
  ],
  lineIds: ["l-0", "l-1", "l-2"],
  lastSession: null,
};

const session = {
  id: "session-1",
  script_id: "script-1",
  my_character_ids: ["c-nina"],
  my_character_names: ["니나"],
  mode: "read",
  start_line_id: "l-0",
  end_line_id: "l-2",
  advance: "manual",
  record: false,
};

const readStats = { mode: "read", elapsedMs: 65_000, lineCount: 3, myCharacterNames: ["니나"], lineResults: [], differentLines: null };
const differentLine = { line_id: "l-2", dialogue_no: 3, said: "그래", different_words: [{ text: "그래,", differs: false }, { text: "배우.", differs: true }] };

const originalFetch = globalThis.fetch;
let requests;

function serve(handler) {
  requests = [];
  globalThis.fetch = async (url, init = {}) => {
    const req = { route: `${init.method ?? "GET"} ${String(url)}`, body: init.body ? JSON.parse(init.body) : undefined };
    requests.push(req);
    return handler(req);
  };
}

const json = (payload, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });

const flush = () => act(async () => {
  await new Promise((r) => setTimeout(r, 0));
});

function seed(stats = readStats) {
  window.sessionStorage.setItem("reading.script.v2", JSON.stringify(script));
  window.sessionStorage.setItem("reading.session", JSON.stringify(session));
  window.sessionStorage.setItem("reading.stats", JSON.stringify(stats));
}

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
  _resetCompletion();
  nav.pushed.length = 0;
  nav.replaced.length = 0;
  setTokens({ access_token: "guest-access", refresh_token: "guest-refresh" });
});

afterEach(() => {
  cleanup();
  _resetCompletion();
  globalThis.fetch = originalFetch;
  clearTokens();
});

test("reading.session: 결과가 없으면 완료 화면을 그리지 않고 실행 화면으로 돌려보낸다", async () => {
  window.sessionStorage.setItem("reading.script.v2", JSON.stringify(script));
  window.sessionStorage.setItem("reading.session", JSON.stringify(session));
  serve(() => json({}));
  render(react.createElement(DonePage));
  await flush();

  assert.deepEqual(nav.replaced, ["/reading/run"]);
  assert.equal(screen.queryByText("리딩을 마쳤어요"), null);
});

test("reading.session: read 완료 응답이 없었으면 회차 상세를 읽어 다시 볼 대사를 채운다", async () => {
  seed();
  serve((req) => (req.route === "GET /v2/reading/sessions/session-1" ? json({ ...session, different_lines: [differentLine] }) : json({})));
  render(react.createElement(DonePage));
  await flush();

  assert.equal(requests.filter((r) => r.route === "GET /v2/reading/sessions/session-1").length, 1);
  screen.getByText("리딩을 마쳤어요");
  screen.getByText("암기 필요 1");
  screen.getByText("그래, 배우.");
});

test("reading.session: 완료 저장이 아직 끝나지 않았으면 저장 중을 보이고 회차 상세를 읽지 않는다", async () => {
  seed();
  startCompletionRetry("session-1", { progress_seq: 2, complete: true, elapsed_seconds: 65, line_results: [] }, {
    send: () => new Promise(() => {}),
    schedule: () => () => {},
  });
  serve(() => json({}));
  render(react.createElement(DonePage));
  await flush();

  screen.getByText("저장 중 · 연결되면 자동으로 저장돼요");
  assert.equal(requests.some((r) => r.route.startsWith("GET /v2/reading/sessions/")), false);
});

test("reading.session: 다시 리딩은 같은 배역·방식·구간으로 새 회차를 만들고 지난번 상대 목소리 설정으로 실행 화면에 간다", async () => {
  seed({ ...readStats, differentLines: [] });
  window.sessionStorage.setItem("reading.run_prefs", JSON.stringify({ partnerVoice: "text" }));
  serve((req) => (req.route.startsWith("POST") ? json({ ...session, id: "session-2" }, 201) : json({})));
  render(react.createElement(DonePage));
  await flush();

  fireEvent.click(screen.getByRole("button", { name: "다시 리딩" }));
  await flush();

  const post = requests.find((r) => r.route === "POST /v2/reading/scripts/script-1/sessions");
  const { request_id: _id, ...body } = post.body;
  assert.deepEqual(body, {
    my_character_ids: ["c-nina"],
    mode: "read",
    start_line_id: "l-0",
    end_line_id: "l-2",
    advance: "manual",
    record: false,
  });
  assert.deepEqual(nav.pushed, ["/reading/run"]);
  assert.equal(JSON.parse(window.sessionStorage.getItem("reading.session")).id, "session-2");
  assert.equal(window.sessionStorage.getItem("reading.stats"), null);
  assert.deepEqual(JSON.parse(window.sessionStorage.getItem("reading.run_prefs")), { partnerVoice: "text" });
});

test("reading.session: 지난번 기기 설정이 없으면 다시 리딩은 기기 목소리(Supertonic)로 시작한다", async () => {
  seed({ ...readStats, differentLines: [] });
  serve((req) => (req.route.startsWith("POST") ? json({ ...session, id: "session-2" }, 201) : json({})));
  render(react.createElement(DonePage));
  await flush();

  fireEvent.click(screen.getByRole("button", { name: "다시 리딩" }));
  await flush();

  assert.deepEqual(JSON.parse(window.sessionStorage.getItem("reading.run_prefs")), { partnerVoice: "supertonic" });
});

test("reading.memorization: 전체보기는 다시 볼 대사의 줄 id 와 내 배역으로 암기 화면을 연다", async () => {
  seed({ ...readStats, differentLines: [differentLine] });
  serve(() => json({}));
  render(react.createElement(DonePage));
  await flush();

  fireEvent.click(screen.getByRole("button", { name: "전체보기" }));

  assert.deepEqual(JSON.parse(window.sessionStorage.getItem("reading.memorize")), { scriptId: "script-1", roles: ["니나"], lineIds: ["l-2"] });
  assert.deepEqual(nav.pushed, ["/reading/memorize"]);
});

test("reading.session: 새 대본은 기기의 대본·회차·결과를 비우고 대본 넣기로, 나머지 버튼은 배역 화면·대본 상세로 간다", async () => {
  seed({ ...readStats, differentLines: [] });
  serve(() => json({}));
  render(react.createElement(DonePage));
  await flush();

  fireEvent.click(screen.getByRole("button", { name: "배역·방식 바꾸기" }));
  fireEvent.click(screen.getByRole("button", { name: "회차 목록 보기" }));
  fireEvent.click(screen.getByRole("button", { name: "새 대본" }));

  assert.deepEqual(nav.pushed, ["/reading/setup", "/reading/scripts/script-1", "/reading"]);
  for (const key of ["reading.script.v2", "reading.session", "reading.stats"]) assert.equal(window.sessionStorage.getItem(key), null, key);
});
