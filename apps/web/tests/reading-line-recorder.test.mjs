// reading.recording — 실행 화면이 내 차례마다 한 줄을 녹음해 올리기 큐에 넣는 훅(useLineRecorder)과, 완료 화면의
// "저장 중"(useCompletionPending). MediaRecorder·마이크·fetch 는 대역이고, 서버로 나간 multipart 칸과 화면 글자를 본다.
import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";

import "./ts-module-loader.mjs";
import { react, window } from "./mount-probe.mjs";
import { FakeMediaRecorder, installRecorder, uninstallRecorder } from "./fixtures/reading-media-recorder-fake.mjs";

process.env.NEXT_PUBLIC_API_BASE_URL = "";

const { cleanup, render, screen, waitFor } = await import("@testing-library/react");
const { setTokens } = await import("../src/lib/auth/token-store.ts");
const { CompletionPendingProbe, LineRecorderProbe } = await import("./fixtures/reading-line-recorder-probe.tsx");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

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

function session(overrides = {}) {
  return { id: "s-1", recordings: [], ...overrides };
}

const me = (index) => ({ status: "me", index });
const ai = (index) => ({ status: "ai", index });

let requests;
let replies;
let mic;
const originalFetch = globalThis.fetch;

function recordingJson(lineId) {
  return { id: `r-${lineId}`, line_id: lineId, attempt_no: 1, duration_ms: 1000, content_type: "audio/mp4", byte_size: 1, transcript: null, transcript_source: "none", matched: null, playback_url: null, playback_expires_at: null };
}

beforeEach(() => {
  requests = [];
  replies = [];
  mic = installRecorder();
  setTokens({ access_token: "guest-access", refresh_token: "guest-refresh" });
  globalThis.fetch = async (url, init = {}) => {
    const route = `${init.method ?? "GET"} ${String(url)}`;
    const headers = new Headers(init.headers);
    if (init.body instanceof FormData) {
      const audio = init.body.get("audio");
      const fields = {};
      for (const [k, v] of init.body.entries()) if (k !== "audio") fields[k] = v;
      requests.push({ route, requestId: headers.get("X-Request-Id"), fields, audio: { name: audio.name, type: audio.type, size: audio.size } });
      const reply = replies.shift();
      if (reply) return reply();
      return new Response(JSON.stringify(recordingJson(fields.line_id)), { status: 201, headers: { "Content-Type": "application/json" } });
    }
    requests.push({ route, body: init.body === undefined ? undefined : JSON.parse(init.body) });
    const reply = replies.shift();
    if (reply) return reply();
    return new Response(JSON.stringify({}), { status: 200, headers: { "Content-Type": "application/json" } });
  };
});

afterEach(() => {
  cleanup();
  mock.timers.reset();
  uninstallRecorder();
  globalThis.fetch = originalFetch;
  window.sessionStorage.clear();
});

let latest;
function mount(args) {
  const onRender = (r) => {
    latest = r;
  };
  const view = render(react.createElement(LineRecorderProbe, { args, onRender }));
  return {
    rerender: (next) => view.rerender(react.createElement(LineRecorderProbe, { args: next, onRender })),
    unmount: view.unmount,
  };
}
const shown = () => screen.getAllByRole("status")[0].textContent;
const settle = () => new Promise((r) => setTimeout(r, 0));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test("reading.recording: 내 차례에 녹음하고 다음 줄로 넘어가면 그 줄을 줄 id·이어 센 시도 번호·길이·전사와 함께 한 요청으로 올린다", async () => {
  mock.timers.enable({ apis: ["Date"], now: 1_000 });
  const args = { script, session: session({ recordings: [{ line_id: "l-1", attempt_no: 2 }] }), enabled: true };
  const view = mount({ ...args, state: me(1) });
  await waitFor(() => assert.equal(shown(), "녹음 중 · 남은 0 · 안내 없음"));
  assert.deepEqual(mic.requests, [{ audio: { echoCancellation: true, noiseSuppression: true }, video: false }]);

  FakeMediaRecorder.instances[0].emit(5);
  latest.noteTranscript("l-1", "하나", null, "stt");
  mock.timers.tick(1_500);
  view.rerender({ ...args, state: ai(2) });

  await waitFor(() => assert.equal(requests.length, 1));
  const [sent] = requests;
  assert.equal(sent.route, "POST /v2/reading/sessions/s-1/recordings");
  assert.match(sent.fields.request_id, UUID);
  assert.equal(sent.requestId, sent.fields.request_id);
  assert.deepEqual(
    { ...sent.fields, request_id: "*" },
    { request_id: "*", line_id: "l-1", attempt_no: "3", duration_ms: "1500", transcript_source: "stt", transcript: "하나" },
  );
  assert.deepEqual(sent.audio, { name: "line.webm", type: "audio/webm;codecs=opus", size: 5 });
  await waitFor(() => assert.equal(shown(), "녹음 안 함 · 남은 0 · 안내 없음"));
  assert.equal(mic.stoppedTracks, 1);
});

test("reading.recording: 입력하기로 대조한 줄은 녹음을 버리고 올리지 않으며, 다음 내 줄은 그대로 올린다", async () => {
  const args = { script, session: session(), enabled: true };
  const view = mount({ ...args, state: me(1) });
  await waitFor(() => assert.equal(latest.recording, true));
  FakeMediaRecorder.instances[0].emit(4);
  latest.noteTranscript("l-1", "하나", true, "typed");
  view.rerender({ ...args, state: ai(2) });
  await settle();
  assert.equal(mic.stoppedTracks, 1);
  assert.deepEqual(requests, []);

  view.rerender({ ...args, state: me(3) });
  await waitFor(() => assert.equal(latest.recording, true));
  FakeMediaRecorder.instances[1].emit(4);
  latest.noteTranscript("l-3", "셋", false, "stt");
  view.rerender({ ...args, state: { status: "done", index: 3 } });
  await waitFor(() => assert.equal(requests.length, 1));
  assert.deepEqual([requests[0].fields.line_id, requests[0].fields.transcript, requests[0].fields.matched], ["l-3", "셋", "false"]);
});

test("reading.recording: 같은 줄을 \"다시\" 하면 지금 것을 올리고 새 시도를 녹음하며, 화면을 떠나면 마지막 시도를 올린다", async () => {
  const args = { script, session: session(), enabled: true, state: me(1) };
  mount(args);
  await waitFor(() => assert.equal(latest.recording, true));
  FakeMediaRecorder.instances[0].emit(3);
  latest.noteTranscript("l-1", "하나", true, "stt");

  react.act(() => latest.restart());
  await waitFor(() => assert.equal(FakeMediaRecorder.instances.length, 2));
  await waitFor(() => assert.equal(latest.recording, true));
  FakeMediaRecorder.instances[1].emit(6);
  react.act(() => latest.finish());

  await waitFor(() => assert.equal(requests.length, 2));
  assert.deepEqual(
    requests.map((r) => [r.fields.line_id, r.fields.attempt_no, r.fields.transcript_source, r.fields.matched ?? null, r.audio.size]),
    [
      ["l-1", "1", "stt", "true", 3],
      ["l-1", "2", "none", null, 6],
    ],
  );
  assert.equal(latest.recording, false);
});

test("reading.recording: 녹음 중에 화면이 닫혀도 그 줄 녹음을 올린다", async () => {
  const view = mount({ script, session: session(), enabled: true, state: me(3) });
  await waitFor(() => assert.equal(latest.recording, true));
  FakeMediaRecorder.instances[0].emit(2);
  view.unmount();
  await waitFor(() => assert.equal(requests.length, 1));
  assert.equal(requests[0].fields.line_id, "l-3");
});

test("reading.recording: 10,000,000바이트를 넘는 녹음은 보내지 않고 \"이 줄 녹음은 너무 길어 저장하지 않았어요.\" 를 보인다", async () => {
  const args = { script, session: session(), enabled: true };
  const view = mount({ ...args, state: me(1) });
  await waitFor(() => assert.equal(latest.recording, true));
  FakeMediaRecorder.instances[0].emit(10_000_001);
  view.rerender({ ...args, state: ai(2) });
  await waitFor(() => assert.equal(shown(), "녹음 안 함 · 남은 0 · 이 줄 녹음은 너무 길어 저장하지 않았어요."));
  assert.deepEqual(requests, []);
});

test("reading.recording: 녹음이 꺼진 회차와 녹음을 못 하는 브라우저는 마이크를 열지 않는다", async () => {
  const args = { script, session: session(), state: me(1) };
  const view = mount({ ...args, enabled: false });
  await settle();
  assert.equal(shown(), "녹음 안 함 · 남은 0 · 안내 없음");

  delete globalThis.MediaRecorder;
  view.rerender({ ...args, enabled: true });
  await settle();
  assert.deepEqual(mic.requests, []);

  globalThis.MediaRecorder = FakeMediaRecorder;
  view.rerender({ ...args, enabled: true, state: me(3) });
  await waitFor(() => assert.equal(latest.recording, true));
  assert.equal(mic.requests.length, 1);
});

test("reading.recording: 마이크를 열 수 없으면 녹음 없이 진행하고, 다음 내 차례에도 다시 묻지 않는다", async () => {
  mic = installRecorder({ open: async () => Promise.reject(new Error("NotAllowedError")) });
  const args = { script, session: session(), enabled: true };
  const view = mount({ ...args, state: me(1) });
  await waitFor(() => assert.equal(mic.requests.length, 1));
  await settle();
  view.rerender({ ...args, state: ai(2) });
  view.rerender({ ...args, state: me(3) });
  await settle();
  assert.equal(mic.requests.length, 1);
  assert.equal(shown(), "녹음 안 함 · 남은 0 · 안내 없음");
  assert.deepEqual(requests, []);
});

test("reading.recording: 마이크가 열리기 전에 줄이 바뀌면 그 녹음을 버리고 마이크를 놓는다", async () => {
  const opening = deferred();
  mic = installRecorder({ open: (stream) => opening.promise.then(stream) });
  const args = { script, session: session(), enabled: true };
  const view = mount({ ...args, state: me(1) });
  await waitFor(() => assert.equal(mic.requests.length, 1));
  view.rerender({ ...args, state: ai(2) });
  opening.resolve();
  await waitFor(() => assert.equal(mic.stoppedTracks, 1));
  assert.equal(FakeMediaRecorder.instances[0].state, "inactive");
  assert.equal(latest.recording, false);
  assert.deepEqual(requests, []);
});

test("reading.recording: 올리는 동안 남은 녹음 수가 보이고, 완료 화면은 \"녹음 올리는 중\" 이었다가 끝나면 바뀐다", async () => {
  const upload = deferred();
  replies.push(() => upload.promise);
  const args = { script, session: session(), enabled: true };
  const view = mount({ ...args, state: me(1) });
  render(react.createElement(CompletionPendingProbe, { sessionId: null }));
  await waitFor(() => assert.equal(latest.recording, true));
  FakeMediaRecorder.instances[0].emit(2);
  view.rerender({ ...args, state: ai(2) });

  await waitFor(() => assert.equal(screen.getAllByRole("status")[0].textContent, "녹음 안 함 · 남은 1 · 안내 없음"));
  await waitFor(() => assert.equal(screen.getAllByRole("status")[1].textContent, "완료 저장 끝 · 녹음 올리는 중"));

  upload.resolve(new Response(JSON.stringify(recordingJson("l-1")), { status: 201, headers: { "Content-Type": "application/json" } }));
  await waitFor(() => assert.equal(screen.getAllByRole("status")[1].textContent, "완료 저장 끝 · 녹음 다 올림"));
  assert.equal(shown(), "녹음 안 함 · 남은 0 · 안내 없음");
});

test("reading.session: 새 페이지의 완료 화면은 기기에 남은 완료 저장을 이어 보내고, 끝날 때까지 \"저장 중\" 이다", async () => {
  const body = { progress_seq: 4, current_line_id: null, elapsed_seconds: 30, line_results: [], complete: true };
  window.sessionStorage.setItem("reading.pending_completions", JSON.stringify({ "s-9": body }));
  const saving = deferred();
  replies.push(() => saving.promise);

  render(react.createElement(CompletionPendingProbe, { sessionId: "s-9" }));
  await waitFor(() => assert.equal(shown(), "완료 저장 중 · 녹음 다 올림"));
  await waitFor(() => assert.equal(requests.length, 1));
  assert.deepEqual(requests[0], { route: "PATCH /v2/reading/sessions/s-9/progress", body });

  saving.resolve(new Response(JSON.stringify({ current_line_id: null, elapsed_seconds: 30, progress_seq: 4, status: "completed" }), { status: 200, headers: { "Content-Type": "application/json" } }));
  await waitFor(() => assert.equal(shown(), "완료 저장 끝 · 녹음 다 올림"));
  assert.equal(window.sessionStorage.getItem("reading.pending_completions"), null);
});

test(
  "reading.recording: 두 번째로 연 실행 화면에서도 서버가 거절해 버린 녹음의 안내가 보인다",
  async () => {
    replies.push(() => new Response(JSON.stringify({ detail: "recording_too_long" }), { status: 422, headers: { "Content-Type": "application/json" } }));
    const args = { script, session: session(), enabled: true };
    const view = mount({ ...args, state: me(1) });
    await waitFor(() => assert.equal(latest.recording, true));
    FakeMediaRecorder.instances[0].emit(2);
    view.rerender({ ...args, state: ai(2) });
    await waitFor(() => assert.equal(requests.length, 1));
    await settle();
    assert.equal(shown(), "녹음 안 함 · 남은 0 · 이 줄 녹음은 너무 길어 저장하지 않았어요.");
  },
);
