// reading.session — 실행 화면 둘이 함께 쓰는 회차 연결(useRunSession·useSessionSync). 이어하기 위치, 상대역 목소리 찾기,
// 줄 전환·일시정지마다 서버에 보내는 진행 저장, 완료 저장과 그 재시도, 화면 시계를 본다. fetch 는 대역이다.
import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";

import "./ts-module-loader.mjs";
import { react, window } from "./mount-probe.mjs";

process.env.NEXT_PUBLIC_API_BASE_URL = "";

const { cleanup, render, screen, waitFor } = await import("@testing-library/react");
const { setTokens } = await import("../src/lib/auth/token-store.ts");
const { completionPending, _resetCompletion } = await import("../src/lib/reading/session/completion.ts");
const { RevealedProbe, RunSessionProbe } = await import("./fixtures/reading-run-session-probe.tsx");

const script = {
  id: "script-1",
  title: "봄밤",
  roles: ["니나", "트레", "소냐"],
  characters: [
    { id: "c-a", name: "니나", voicePreset: null, voice: "F1" },
    { id: "c-b", name: "트레", voicePreset: null, voice: "M2" },
    { id: "c-c", name: "소냐", voicePreset: "F3", voice: "F3" },
  ],
  lines: [
    { type: "direction", text: "밤." },
    { type: "dialogue", role: "니나", text: "하나." },
    { type: "dialogue", role: "트레", text: "둘." },
    { type: "dialogue", role: "니나", text: "셋." },
    { type: "dialogue", role: "소냐", text: "넷." },
    { type: "dialogue", role: "니나", text: "다섯." },
  ],
  lineIds: ["l-0", "l-1", "l-2", "l-3", "l-4", "l-5"],
  raw: "",
  lastSession: null,
};

function session(overrides = {}) {
  return {
    id: "s-1",
    mode: "read",
    advance: "manual",
    record: false,
    my_character_ids: ["c-a"],
    my_character_names: ["니나"],
    start_line_id: "l-1",
    end_line_id: "l-5",
    current_line_id: null,
    elapsed_seconds: 10,
    progress_seq: 4,
    line_results: [],
    recordings: [],
    ...overrides,
  };
}

const state = (status, index) => ({ status, index });
const json = (payload, status = 200) => new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
const progressReply = (seq) => json({ current_line_id: null, elapsed_seconds: 0, progress_seq: seq, status: "in_progress", different_lines: [] });

let requests;
let replies;
const originalFetch = globalThis.fetch;

beforeEach(() => {
  requests = [];
  replies = [];
  setTokens({ access_token: "guest-access", refresh_token: "guest-refresh" });
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ route: `${init.method ?? "GET"} ${String(url)}`, body: init.body === undefined ? undefined : JSON.parse(init.body) });
    const reply = replies.shift();
    return reply ? reply() : progressReply(0);
  };
});

afterEach(() => {
  cleanup();
  mock.timers.reset();
  globalThis.fetch = originalFetch;
  _resetCompletion();
  window.localStorage.clear();
});

let latest;
function mount(s) {
  render(react.createElement(RunSessionProbe, { script, session: s, onRender: (run) => (latest = run) }));
}
const shown = () => screen.getByRole("status").textContent;
const settle = () => new Promise((r) => setTimeout(r, 0));

test("reading.session: 이어하기는 저장된 줄 직전의 상대 대사부터 읽고, 그런 대사가 없으면 저장된 줄부터, 저장된 줄이 없으면 구간 처음부터다", () => {
  mount(session({ current_line_id: "l-3" }));
  assert.deepEqual({ myRoles: latest.myRoles, range: latest.range, from: latest.from }, { myRoles: ["니나"], range: { start: 1, end: 5 }, from: 2 });
  cleanup();

  mount(session({ current_line_id: "l-1" }));
  assert.equal(latest.from, 1);
  cleanup();

  mount(session({ current_line_id: null }));
  assert.equal(latest.from, undefined);
});

test("reading.cast: 상대역은 배역마다 서버가 정한 목소리로 읽고, 표에 없는 배역 이름은 첫 상대역 목소리로 읽는다", () => {
  mount(session());
  assert.deepEqual(latest.styleFor("트레"), { device: { pitch: 1.0 }, preset: "M2" });
  assert.deepEqual(latest.styleFor("소냐"), { device: { pitch: 1.12 }, preset: "F3" });
  assert.deepEqual(latest.styleFor("니나의 친구"), { device: { pitch: 1.0 }, preset: "M2" });
});

test("reading.session: 줄이 바뀔 때와 일시정지 때 위치·일시정지를 뺀 누적 시간·순번을 저장하고, 같은 줄에 머물거나 재개만 하면 저장하지 않는다", async () => {
  mock.timers.enable({ apis: ["Date"], now: 100_000 });
  mount(session());
  latest.sync.clock.start();

  const sent = (n) => waitFor(() => assert.equal(requests.length, n));
  mock.timers.tick(3_000);
  latest.track(state("me", 1));
  await sent(1);
  latest.track(state("me", 1));
  mock.timers.tick(2_000);
  latest.track(state("paused", 1));
  await sent(2);
  mock.timers.tick(60_000);
  latest.track(state("me", 1));
  mock.timers.tick(1_000);
  latest.track(state("ai", 2));
  await sent(3);
  latest.track(state("idle", 3));
  latest.track(state("done", 5));
  await settle();
  assert.deepEqual(requests, [
    { route: "PATCH /v2/reading/sessions/s-1/progress", body: { progress_seq: 5, current_line_id: "l-1", elapsed_seconds: 13, line_results: [] } },
    { route: "PATCH /v2/reading/sessions/s-1/progress", body: { progress_seq: 6, current_line_id: "l-1", elapsed_seconds: 15, line_results: [] } },
    { route: "PATCH /v2/reading/sessions/s-1/progress", body: { progress_seq: 7, current_line_id: "l-2", elapsed_seconds: 16, line_results: [] } },
  ]);
});

test("reading.session: 읽어주기는 이번에 말한 것만 줄 결과로 보내고, 암기 대조는 저장된 줄 결과에서 이어 보낸다", async () => {
  const saved = [{ line_id: "l-1", outcome: "passed", misses: 0 }];
  mount(session({ mode: "read", line_results: saved }));
  latest.sync.results.say("l-3", "셋");
  latest.sync.save(state("me", 3));
  await waitFor(() => assert.equal(requests.length, 1));
  assert.deepEqual(requests[0].body.line_results, [{ line_id: "l-3", said: "셋" }]);
  cleanup();

  mount(session({ mode: "quiz", line_results: saved }));
  latest.sync.save(state("me", 3));
  await waitFor(() => assert.equal(requests.length, 2));
  assert.deepEqual(requests[1].body.line_results, saved);
});

test("reading.session: 대본에 없는 위치를 저장하면 위치를 비워 보낸다", async () => {
  mount(session());
  latest.sync.save(state("me", 9));
  await waitFor(() => assert.equal(requests.length, 1));
  assert.equal(requests[0].body.current_line_id, null);
});

test("reading.session: 구간 끝을 지나면 시계를 멈추고 complete 를 보내 완료 응답을 돌려준다", async () => {
  mock.timers.enable({ apis: ["Date"], now: 0 });
  replies.push(() => json({ current_line_id: null, elapsed_seconds: 14, progress_seq: 5, status: "completed", different_lines: [] }));
  mount(session());
  latest.sync.clock.start();
  mock.timers.tick(4_000);
  const answer = await latest.sync.finish();
  mock.timers.tick(9_000);

  assert.deepEqual(requests, [
    { route: "PATCH /v2/reading/sessions/s-1/progress", body: { progress_seq: 5, current_line_id: null, elapsed_seconds: 14, line_results: [], complete: true } },
  ]);
  assert.deepEqual(answer, { current_line_id: null, elapsed_seconds: 14, progress_seq: 5, status: "completed", different_lines: [] });
  assert.equal(latest.sync.clock.elapsedMs(), 14_000);
  assert.equal(completionPending("s-1"), false);
});

test("reading.session: 완료 저장이 연결 끊김으로 실패하면 null 을 돌려주고 같은 본문으로 다시 보내 끝낸다", async () => {
  replies.push(() => Promise.reject(new TypeError("fetch failed")));
  mount(session());
  const answer = await latest.sync.finish();
  assert.equal(answer, null);
  assert.equal(completionPending("s-1"), true);

  await waitFor(() => assert.equal(completionPending("s-1"), false));
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1], requests[0]);
  assert.deepEqual(requests[0].body, { progress_seq: 5, current_line_id: null, elapsed_seconds: 10, line_results: [], complete: true });
});

test("reading.session: 이미 끝난 회차(409 session_closed)면 완료 저장을 다시 보내지 않는다", async () => {
  replies.push(() => json({ detail: "session_closed" }, 409));
  mount(session());
  assert.equal(await latest.sync.finish(), null);
  await settle();
  assert.equal(requests.length, 1);
  assert.equal(completionPending("s-1"), false);
});

test("reading.session: 화면의 흐른 시간은 저장된 누적 시간에서 이어 1초마다 바뀐다", () => {
  mock.timers.enable({ apis: ["setInterval", "Date"], now: 0 });
  mount(session({ elapsed_seconds: 10 }));
  assert.equal(shown(), "흐른 10000ms · 가리기 show_all");
  latest.sync.clock.start();
  react.act(() => mock.timers.tick(1_000));
  assert.equal(shown(), "흐른 11000ms · 가리기 show_all");
  react.act(() => mock.timers.tick(2_000));
  assert.equal(shown(), "흐른 13000ms · 가리기 show_all");
});

test("reading.session: 완료 화면으로 넘기는 결과에는 방식·흐른 시간·대사 수·내 배역·줄 결과·서버가 준 다르게 말한 대사가 있다", () => {
  mount(session({ mode: "quiz", line_results: [{ line_id: "l-1", outcome: "unmatched", misses: 2 }] }));
  latest.sync.results.say("l-3", "셋");
  const different = [{ line_id: "l-1", dialogue_no: 1, said: "하", different_words: [] }];
  assert.deepEqual(latest.stats("quiz", 5, { different_lines: different }), {
    mode: "quiz",
    elapsedMs: 10_000,
    lineCount: 5,
    myCharacterNames: ["니나"],
    lineResults: [{ line_id: "l-1", outcome: "unmatched", misses: 2 }],
    differentLines: different,
  });
  assert.equal(latest.stats("read", 5).differentLines, null);
});

test("reading.session: 가리기는 대본마다 기기에 남은 값으로 시작하고 실행 중에 바꿀 수 있다", () => {
  window.localStorage.setItem("acttub.reading.mask", JSON.stringify({ "script-1": "hide_mine" }));
  mount(session());
  assert.equal(shown(), "흐른 10000ms · 가리기 hide_mine");
  react.act(() => latest.setMask("hide_all"));
  assert.equal(shown(), "흐른 10000ms · 가리기 hide_all");
});

test("reading.session: \"원문 보기\"는 그 줄만 풀고 줄이 바뀌면 다시 가린다", () => {
  let reveal;
  const onRender = ([, r]) => (reveal = r);
  const view = render(react.createElement(RevealedProbe, { lineIndex: 3, onRender }));
  assert.equal(shown(), "가림");
  react.act(() => reveal());
  assert.equal(shown(), "원문 보임");
  view.rerender(react.createElement(RevealedProbe, { lineIndex: 5, onRender }));
  assert.equal(shown(), "가림");
});
