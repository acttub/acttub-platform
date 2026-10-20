// reading.recording — 올리기 큐의 나머지 갈래(429·권한 거절, 기본 시계·타이머·창, 탭 닫기 알림 해제, 구독, 앱 전체 큐)와
// 회차 상세의 길이 표시, 파일 확장자. reading-recording-queue.test.mjs 가 본 흐름을 덮는다.
import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";

import "./ts-module-loader.mjs";

const { ApiError, NetworkError } = await import("../src/lib/api/v2/errors.ts");
const { createRecordingQueue, PENDING_UNLOAD_COPY, sharedRecordingQueue } = await import("../src/lib/reading/recording/queue.ts");
const { durationLabel } = await import("../src/lib/reading/recording/playback.ts");
const { extensionFor } = await import("../src/lib/reading/recording/limits.ts");

function item(overrides = {}) {
  return {
    requestId: "req-1",
    sessionId: "s-1",
    lineId: "l-1",
    attemptNo: 1,
    blob: new Blob([new Uint8Array(3)], { type: "audio/webm" }),
    contentType: "audio/webm",
    durationMs: 1000,
    transcript: null,
    transcriptSource: "none",
    matched: null,
    createdAt: Date.now(),
    ...overrides,
  };
}

function fakeWindow() {
  const listeners = new Set();
  return {
    listeners,
    addEventListener: (_name, cb) => listeners.add(cb),
    removeEventListener: (_name, cb) => listeners.delete(cb),
  };
}

afterEach(() => {
  mock.timers.reset();
  delete globalThis.window;
});

test("reading.recording: 429 는 잠시 뒤 같은 요청 id 로 다시 보내고, 권한 거절(403)은 다시 보내지 않고 버리며 안내한다", async () => {
  const delays = [];
  const notices = [];
  const sent = [];
  const replies = [new ApiError(429, "rate_limited", "rate_limited"), null, new ApiError(403, "forbidden", "forbidden")];
  const q = createRecordingQueue({
    send: async (it) => {
      sent.push(it.requestId);
      const reply = replies.shift();
      if (reply) throw reply;
    },
    schedule: (fn, ms) => {
      delays.push([fn, ms]);
      return () => {};
    },
    onNotice: (m) => notices.push(m),
    window: null,
  });
  q.enqueue(item({ requestId: "busy" }));
  await q.flush();
  assert.deepEqual(delays.map(([, ms]) => ms), [2_000]);
  assert.equal(q.pending(), 1);
  await delays[0][0]();
  assert.equal(q.pending(), 0);

  q.enqueue(item({ requestId: "denied" }));
  await q.flush();
  assert.deepEqual(sent, ["busy", "busy", "denied"]);
  assert.equal(q.pending(), 0);
  assert.deepEqual(notices, ["이 줄 녹음을 저장하지 못했어요."]);
  assert.equal(delays.length, 1);
});

test("reading.recording: 연결·서버 문제가 아닌 실패는 다시 보내지 않고 버리며 안내한다", async () => {
  const notices = [];
  const scheduled = [];
  const q = createRecordingQueue({
    send: async () => {
      throw new Error("Failed to construct 'File'");
    },
    schedule: (fn, ms) => {
      scheduled.push(ms);
      return () => {};
    },
    onNotice: (m) => notices.push(m),
    window: null,
  });
  q.enqueue(item());
  await q.flush();
  assert.equal(q.pending(), 0);
  assert.deepEqual(scheduled, []);
  assert.deepEqual(notices, ["이 줄 녹음을 저장하지 못했어요."]);
});

test("reading.recording: 구독하면 남은 녹음 수가 바뀔 때마다 받고, 구독을 풀면 더 받지 않는다", async () => {
  const q = createRecordingQueue({ send: async () => {}, window: null });
  const seen = [];
  const off = q.subscribe((n) => seen.push(n));
  q.enqueue(item());
  await q.flush();
  assert.deepEqual(seen, [1, 0]);
  off();
  q.enqueue(item({ requestId: "req-2" }));
  await q.flush();
  assert.deepEqual(seen, [1, 0]);
});

test("reading.recording: 저장이 끝나면 탭 닫기 알림을 거두고, 이미 걸린 알림도 남은 녹음이 없으면 막지 않는다", async () => {
  let fail = true;
  const retries = [];
  const win = fakeWindow();
  const q = createRecordingQueue({
    send: async () => {
      if (fail) throw new NetworkError();
    },
    schedule: (fn) => {
      retries.push(fn);
      return () => {};
    },
    window: win,
  });
  q.enqueue(item());
  await q.flush();
  assert.equal(win.listeners.size, 1);
  const [onBeforeUnload] = win.listeners;

  fail = false;
  await retries[0]();
  assert.equal(q.pending(), 0);
  assert.equal(win.listeners.size, 0);

  const ev = { prevented: false, returnValue: "", preventDefault() { this.prevented = true; } };
  onBeforeUnload(ev);
  assert.deepEqual([ev.prevented, ev.returnValue], [false, ""]);
});

test("reading.recording: 기본 설정의 큐는 브라우저 창에 탭 닫기 알림을 걸고, 실패하면 실제 2초 뒤에 다시 보낸다", async () => {
  mock.timers.enable({ apis: ["setTimeout", "Date"], now: 50_000 });
  const win = fakeWindow();
  globalThis.window = win;
  const sentAt = [];
  let fail = true;
  const q = createRecordingQueue({
    send: async () => {
      sentAt.push(Date.now());
      if (fail) throw new NetworkError();
    },
  });
  q.enqueue(item({ createdAt: 50_000 }));
  await q.flush();
  assert.equal(win.listeners.size, 1);
  const ev = { prevented: false, returnValue: "", preventDefault() { this.prevented = true; } };
  [...win.listeners][0](ev);
  assert.equal(ev.returnValue, PENDING_UNLOAD_COPY);

  fail = false;
  mock.timers.tick(1_999);
  await Promise.resolve();
  assert.deepEqual(sentAt, [50_000]);
  mock.timers.tick(1);
  for (let i = 0; i < 5 && q.pending() > 0; i++) await Promise.resolve();
  assert.deepEqual(sentAt, [50_000, 52_000]);
  assert.equal(q.pending(), 0);
  assert.equal(win.listeners.size, 0);
});

test("reading.recording: 창이 없는 곳(서버)의 기본 큐는 탭 닫기 알림 없이 보낸다", async () => {
  const sent = [];
  const q = createRecordingQueue({ send: async (it) => void sent.push(it.lineId) });
  q.enqueue(item({ lineId: "l-9" }));
  await q.flush();
  assert.deepEqual(sent, ["l-9"]);
});

test("reading.recording: 앱 전체 큐는 처음 만든 하나를 계속 쓴다", () => {
  const made = [];
  const create = () => {
    const q = createRecordingQueue({ send: async () => {}, window: null });
    made.push(q);
    return q;
  };
  const first = sharedRecordingQueue(create);
  const second = sharedRecordingQueue(create);
  assert.equal(made.length, 1);
  assert.equal(second, first);
});

test("reading.recording: 회차 상세의 녹음 길이는 초를 반올림한 m:ss 다", () => {
  assert.equal(durationLabel(61_400), "1:01");
  assert.equal(durationLabel(59_600), "1:00");
  assert.equal(durationLabel(4_000), "0:04");
});

test("reading.recording: 올리는 파일 이름의 확장자는 content_type 을 따른다 — aac·m4a 는 m4a, wav 는 wav, 모르는 것은 webm", () => {
  assert.equal(extensionFor("audio/aac"), "m4a");
  assert.equal(extensionFor("audio/x-m4a"), "m4a");
  assert.equal(extensionFor("Audio/WAV"), "wav");
  assert.equal(extensionFor("audio/x-wav"), "wav");
  assert.equal(extensionFor("audio/flac"), "webm");
});
