// reading.recording — 회차 카드를 펼친 녹음 목록(SessionRecordings). 줄 순서 목록·길이·전사, "이어 듣기", 만료된 재생 주소의
// 재조회, 개별 삭제를 본다. fetch 와 Audio 는 대역이고, 서버로 나간 요청과 화면 글자·재생한 주소를 단언한다.
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import "./ts-module-loader.mjs";
import { react } from "./mount-probe.mjs";

process.env.NEXT_PUBLIC_API_BASE_URL = "";

const { act, cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react");
const { setTokens } = await import("../src/lib/auth/token-store.ts");
const { SessionRecordings } = await import("../src/features/reading/screens/SessionRecordings.tsx");

const script = {
  id: "script-1",
  title: "봄밤",
  roles: ["니나", "트레"],
  characters: [],
  lines: [
    { type: "direction", text: "밤." },
    { type: "dialogue", role: "니나", text: "하나." },
    { type: "dialogue", role: "트레", text: "둘." },
    { type: "dialogue", role: "니나", text: "셋." },
  ],
  lineIds: ["l-0", "l-1", "l-2", "l-3"],
  raw: "",
  lastSession: null,
};

const LIVE = "2999-01-01T00:00:00Z";
const EXPIRED = "2000-01-01T00:00:00Z";

function recording(id, lineId, overrides = {}) {
  return {
    id,
    line_id: lineId,
    attempt_no: 1,
    duration_ms: 1_400,
    content_type: "audio/mp4",
    byte_size: 10,
    transcript: null,
    transcript_source: "none",
    matched: null,
    playback_url: `https://cdn/${id}`,
    playback_expires_at: LIVE,
    ...overrides,
  };
}

const json = (payload, status = 200) => new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
const detail = (recordings) => json({ id: "s-1", recordings });

class FakeAudio {
  static instances = [];
  constructor() {
    this.src = "";
    this.paused = 0;
    this.played = [];
    this.onended = null;
    this.onerror = null;
    this.playResult = () => Promise.resolve();
    FakeAudio.instances.push(this);
  }
  pause() {
    this.paused++;
  }
  play() {
    this.played.push(this.src);
    return this.playResult();
  }
}

let requests;
let replies;
let changed;
const originalFetch = globalThis.fetch;

beforeEach(() => {
  requests = [];
  replies = [];
  changed = 0;
  FakeAudio.instances = [];
  globalThis.Audio = FakeAudio;
  setTokens({ access_token: "guest-access", refresh_token: "guest-refresh" });
  globalThis.fetch = async (url, init = {}) => {
    requests.push(`${init.method ?? "GET"} ${String(url)}`);
    const reply = replies.shift();
    return reply ? reply() : detail([]);
  };
});

afterEach(() => {
  cleanup();
  delete globalThis.Audio;
  globalThis.fetch = originalFetch;
});

function mount(sessionId = "s-1") {
  const props = { script, sessionId, onChanged: () => changed++ };
  const view = render(react.createElement(SessionRecordings, props));
  return { ...view, rerender: (id) => view.rerender(react.createElement(SessionRecordings, { ...props, sessionId: id })) };
}
const body = () => document.body.textContent;
const audio = () => FakeAudio.instances[0];
const click = (el) => act(async () => {
  fireEvent.click(el);
  await new Promise((r) => setTimeout(r, 0));
});

test("reading.recording: 펼치면 회차를 다시 받아 내 대사 녹음을 줄 순서로 원문·길이·전사와 함께 보인다", async () => {
  replies.push(() => detail([recording("r-3", "l-3"), recording("r-1", "l-1", { transcript: "하나", transcript_source: "stt", matched: true })]));
  mount();
  assert.equal(body(), "녹음을 불러오는 중…");
  await waitFor(() => assert.equal(screen.getAllByRole("listitem").length, 2));
  assert.deepEqual(requests, ["GET /v2/reading/sessions/s-1"]);
  assert.deepEqual(
    screen.getAllByRole("listitem").map((li) => li.textContent),
    ["니나하나.0:01 · 듣기지우기방금 말한 것: 하나", "니나셋.0:01 · 듣기지우기"],
  );
  assert.equal(screen.getByText("내 대사 녹음 2개를 줄 순서대로 들어요").tagName, "SPAN");
});

test("reading.recording: 녹음이 없으면 \"이 회차에는 녹음이 없어요.\", 목록을 못 받으면 안내 문구다", async () => {
  mount();
  await waitFor(() => assert.equal(body(), "이 회차에는 녹음이 없어요."));
  cleanup();

  replies.push(() => json({ detail: "internal_error" }, 500));
  mount();
  await waitFor(() => assert.equal(body(), "녹음 목록을 불러오지 못했어요."));
});

test("reading.recording: 이어 듣기는 내 대사 녹음을 줄 순서대로 끝까지 틀고, 다 들으면 다시 \"이어 듣기\" 가 된다", async () => {
  replies.push(() => detail([recording("r-1", "l-1"), recording("r-3", "l-3")]));
  mount();
  await waitFor(() => screen.getByRole("button", { name: "이어 듣기" }));
  await click(screen.getByRole("button", { name: "이어 듣기" }));
  assert.deepEqual(audio().played, ["https://cdn/r-1"]);
  assert.equal(screen.getAllByRole("listitem")[0].textContent.includes("재생 중"), true);
  assert.equal(screen.getByRole("button", { name: "멈추기" }).tagName, "BUTTON");

  await act(async () => audio().onended());
  assert.deepEqual(audio().played, ["https://cdn/r-1", "https://cdn/r-3"]);
  assert.equal(screen.getAllByRole("listitem")[1].textContent.includes("재생 중"), true);

  await act(async () => audio().onended());
  assert.equal(screen.getByRole("button", { name: "이어 듣기" }).tagName, "BUTTON");
  assert.equal(body().includes("재생 중"), false);
});

test("reading.recording: 듣던 줄을 다시 누르거나 멈추기를 누르면 멈추고, 재생이 막히거나 소리 파일이 깨지면 재생 표시를 거둔다", async () => {
  replies.push(() => detail([recording("r-1", "l-1"), recording("r-3", "l-3")]));
  mount();
  await waitFor(() => screen.getAllByRole("listitem"));
  const line = () => screen.getByRole("button", { name: /셋\./ });
  await click(line());
  assert.deepEqual(audio().played, ["https://cdn/r-3"]);
  const pausedBefore = audio().paused;
  await click(line());
  assert.equal(audio().paused, pausedBefore + 1);
  assert.equal(body().includes("재생 중"), false);

  await click(line());
  await click(screen.getByRole("button", { name: "멈추기" }));
  assert.equal(body().includes("재생 중"), false);

  await click(line());
  await act(async () => audio().onerror());
  assert.equal(body().includes("재생 중"), false);

  audio().playResult = () => Promise.reject(new Error("NotAllowedError"));
  await click(line());
  assert.equal(body().includes("재생 중"), false);
  assert.deepEqual(audio().played, ["https://cdn/r-3", "https://cdn/r-3", "https://cdn/r-3", "https://cdn/r-3"]);
});

test("reading.recording: 재생 주소가 만료됐으면 목록을 다시 받아 새 주소로 튼다", async () => {
  replies.push(() => detail([recording("r-1", "l-1", { playback_expires_at: EXPIRED })]));
  replies.push(() => detail([recording("r-1", "l-1", { playback_url: "https://cdn/r-1?fresh" })]));
  mount();
  await waitFor(() => screen.getAllByRole("listitem"));
  await click(screen.getByRole("button", { name: "이어 듣기" }));
  assert.deepEqual(requests, ["GET /v2/reading/sessions/s-1", "GET /v2/reading/sessions/s-1"]);
  assert.deepEqual(audio().played, ["https://cdn/r-1?fresh"]);
});

test("reading.recording: 다시 받아도 재생 주소가 없거나 다시 받지 못하면 틀지 않고, 받지 못한 이유를 보인다", async () => {
  replies.push(() => detail([recording("r-1", "l-1", { playback_url: null, playback_expires_at: null }), recording("r-3", "l-3", { playback_expires_at: EXPIRED })]));
  replies.push(() => detail([recording("r-1", "l-1", { playback_url: null, playback_expires_at: null })]));
  replies.push(() => json({ detail: "internal_error" }, 500));
  mount();
  await waitFor(() => screen.getAllByRole("listitem"));
  await click(screen.getByRole("button", { name: /하나\./ }));
  assert.deepEqual(FakeAudio.instances, []);
  assert.equal(body().includes("재생 중"), false);

  await click(screen.getByRole("button", { name: /하나\./ }));
  assert.deepEqual(FakeAudio.instances, []);
  assert.equal(body().includes("녹음 목록을 불러오지 못했어요."), true);
  assert.equal(requests.length, 3);
});

test("reading.recording: 지우기를 누르면 그 녹음을 지우는 동안 \"지우는 중…\" 이고, 지운 뒤 목록을 다시 받아 회차 카드에 알린다", async () => {
  let finishDelete;
  replies.push(() => detail([recording("r-1", "l-1"), recording("r-3", "l-3")]));
  replies.push(() => new Promise((r) => (finishDelete = r)));
  replies.push(() => detail([recording("r-3", "l-3")]));
  mount();
  await waitFor(() => screen.getAllByRole("listitem"));
  await click(screen.getAllByRole("button", { name: "지우기" })[0]);
  assert.equal(screen.getByRole("button", { name: "지우는 중…" }).disabled, true);

  await act(async () => finishDelete(new Response(null, { status: 204 })));
  await waitFor(() => assert.equal(screen.getAllByRole("listitem").length, 1));
  assert.deepEqual(requests, ["GET /v2/reading/sessions/s-1", "DELETE /v2/reading/recordings/r-1", "GET /v2/reading/sessions/s-1"]);
  assert.equal(changed, 1);
  assert.equal(screen.getAllByRole("listitem")[0].textContent.startsWith("니나셋."), true);
});

test("reading.recording: 지우지 못하면 목록은 그대로 두고 \"녹음을 지우지 못했어요. 다시 시도해 주세요.\" 를 보인다", async () => {
  replies.push(() => detail([recording("r-1", "l-1")]));
  replies.push(() => json({ detail: "internal_error" }, 500));
  mount();
  await waitFor(() => screen.getAllByRole("listitem"));
  await click(screen.getByRole("button", { name: "지우기" }));
  assert.equal(body().includes("녹음을 지우지 못했어요. 다시 시도해 주세요."), true);
  assert.equal(screen.getAllByRole("listitem").length, 1);
  assert.equal(screen.getByRole("button", { name: "지우기" }).disabled, false);
  assert.equal(changed, 0);
});

test("reading.recording: 다른 회차로 바뀐 뒤 늦게 온 앞 회차의 목록·오류는 그리지 않고, 닫으면 듣던 소리를 멈춘다", async () => {
  let firstList;
  let firstError;
  replies.push(() => new Promise((r) => (firstList = r)));
  replies.push(() => detail([recording("r-3", "l-3")]));
  const view = mount("s-1");
  await waitFor(() => assert.equal(requests.length, 1));
  view.rerender("s-2");
  await waitFor(() => assert.equal(screen.getAllByRole("listitem").length, 1));
  await act(async () => firstList(detail([recording("r-1", "l-1"), recording("r-3", "l-3")])));
  assert.equal(screen.getAllByRole("listitem").length, 1);

  replies.push(() => new Promise((r) => (firstError = r)));
  replies.push(() => detail([recording("r-3", "l-3")]));
  view.rerender("s-3");
  view.rerender("s-4");
  await waitFor(() => assert.equal(requests.length, 4));
  await act(async () => firstError(json({ detail: "internal_error" }, 500)));
  assert.equal(body().includes("녹음 목록을 불러오지 못했어요."), false);
  assert.deepEqual(requests, ["GET /v2/reading/sessions/s-1", "GET /v2/reading/sessions/s-2", "GET /v2/reading/sessions/s-3", "GET /v2/reading/sessions/s-4"]);

  await click(screen.getByRole("button", { name: "이어 듣기" }));
  const pausedBefore = audio().paused;
  view.unmount();
  assert.equal(audio().paused, pausedBefore + 1);
});
