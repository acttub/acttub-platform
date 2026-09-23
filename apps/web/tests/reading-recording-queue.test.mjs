// reading.recording — 기기 쪽 규칙: 한도(10,000,000바이트·180초), 브라우저 형식 고르기, 올리기 큐(재시도·같은 요청 id·대체·폐기),
// 회차 상세의 녹음 표시(요약·재생 주소 만료·이어 듣기 순서).
import assert from "node:assert/strict";
import { test } from "node:test";

import "./ts-module-loader.mjs";

const { ApiError, NetworkError } = await import("../src/lib/api/v2/errors.ts");
const { clipTooLarge, extensionFor, pickRecordingMimeType, RECORDING_MAX_BYTES, RECORDING_MAX_MS, RECORDING_TOO_LARGE_COPY } = await import(
  "../src/lib/reading/recording/limits.ts"
);
const { attemptCounter, createRecordingQueue, PENDING_UNLOAD_COPY, RECORDING_KEEP_MS } = await import("../src/lib/reading/recording/queue.ts");
const { playbackUrl, playlistOf, recordingSummary } = await import("../src/lib/reading/recording/playback.ts");

test("reading.recording: 파일 10,000,001바이트는 보내지 않고 안내하며, 길이 상한은 180초다", () => {
  assert.equal(RECORDING_MAX_BYTES, 10_000_000);
  assert.equal(RECORDING_MAX_MS, 180_000);
  assert.equal(clipTooLarge(10_000_000), false);
  assert.equal(clipTooLarge(10_000_001), true);
  assert.equal(RECORDING_TOO_LARGE_COPY, "이 줄 녹음은 너무 길어 저장하지 않았어요.");
});

test("reading.recording: 브라우저가 내는 형식을 그대로 쓴다 — webm/opus 가 있으면 그것, 없으면 mp4", () => {
  assert.equal(pickRecordingMimeType((t) => t.startsWith("audio/webm")), "audio/webm;codecs=opus");
  assert.equal(pickRecordingMimeType((t) => t === "audio/mp4"), "audio/mp4");
  assert.equal(pickRecordingMimeType(() => false), null);
  assert.equal(extensionFor("audio/webm;codecs=opus"), "webm");
  assert.equal(extensionFor("audio/mp4"), "m4a");
  assert.equal(extensionFor("audio/ogg;codecs=opus"), "ogg");
});

function item(overrides = {}) {
  return {
    requestId: "11111111-1111-4111-8111-111111111111",
    sessionId: "s-1",
    lineId: "l-3",
    attemptNo: 1,
    blob: new Blob([new Uint8Array(3)], { type: "audio/webm" }),
    contentType: "audio/webm",
    durationMs: 1000,
    transcript: null,
    transcriptSource: "none",
    matched: null,
    createdAt: 1_000,
    ...overrides,
  };
}

/** 예약된 재시도를 손으로 실행하는 가짜 스케줄러 */
function fakeScheduler() {
  const timers = [];
  return {
    schedule: (fn, ms) => {
      const t = { fn, ms, cancelled: false };
      timers.push(t);
      return () => {
        t.cancelled = true;
      };
    },
    async fire() {
      const due = timers.splice(0);
      for (const t of due) if (!t.cancelled) await t.fn();
    },
    delays: () => timers.map((t) => t.ms),
  };
}

test("reading.recording: record 켬 회차에서 내 대사 둘을 말하면 줄마다 하나씩 순서대로 올라간다", async () => {
  const sent = [];
  const q = createRecordingQueue({ send: async (it) => void sent.push(it), now: () => 2_000 });
  q.enqueue(item({ lineId: "l-1", requestId: "a" }));
  q.enqueue(item({ lineId: "l-3", requestId: "b" }));
  await q.flush();
  assert.deepEqual(sent.map((s) => [s.lineId, s.requestId]), [["l-1", "a"], ["l-3", "b"]]);
  assert.equal(q.pending(), 0);
});

test("reading.recording: 연결이 끊기면 같은 요청 id 로 다시 보내고, 회차가 끝난 뒤에도 큐가 계속 시도한다", async () => {
  const sent = [];
  let fail = true;
  const sch = fakeScheduler();
  const q = createRecordingQueue({
    send: async (it) => {
      sent.push(it.requestId);
      if (fail) throw new NetworkError();
    },
    now: () => 2_000,
    schedule: sch.schedule,
  });
  q.enqueue(item({ requestId: "same" }));
  await q.flush();
  assert.equal(q.pending(), 1);
  assert.deepEqual(sch.delays(), [2_000]);
  fail = false;
  await sch.fire();
  assert.deepEqual(sent, ["same", "same"]);
  assert.equal(q.pending(), 0);
});

test("reading.recording: 503 audio_conversion_failed 는 같은 요청 id 로 다시 시도하고, 재시도 간격은 늘어난다", async () => {
  const sent = [];
  let failures = 2;
  const sch = fakeScheduler();
  const q = createRecordingQueue({
    send: async (it) => {
      sent.push(it.requestId);
      if (failures-- > 0) throw new ApiError(503, "audio_conversion_failed", "audio_conversion_failed");
    },
    now: () => 2_000,
    schedule: sch.schedule,
  });
  q.enqueue(item({ requestId: "conv" }));
  await q.flush();
  assert.deepEqual(sch.delays(), [2_000]);
  await sch.fire();
  assert.deepEqual(sch.delays(), [4_000]);
  await sch.fire();
  assert.deepEqual(sent, ["conv", "conv", "conv"]);
  assert.equal(q.pending(), 0);
});

test("reading.recording: 422(invalid_line·recording_too_long·recording_quota)와 404 는 다시 보내지 않고 버리며 안내한다", async () => {
  const notices = [];
  const codes = ["invalid_line", "recording_too_long", "recording_quota"];
  let i = 0;
  const q = createRecordingQueue({
    send: async () => {
      const code = codes[i++];
      throw new ApiError(422, code, code);
    },
    now: () => 2_000,
    onNotice: (m) => notices.push(m),
  });
  q.enqueue(item({ requestId: "a", lineId: "l-1" }));
  q.enqueue(item({ requestId: "b", lineId: "l-2" }));
  q.enqueue(item({ requestId: "c", lineId: "l-3" }));
  await q.flush();
  assert.equal(q.pending(), 0);
  assert.equal(notices.length, 3);
  assert.equal(notices[1], "이 줄 녹음은 너무 길어 저장하지 않았어요.");

  const gone = createRecordingQueue({ send: async () => { throw new ApiError(404, "session_not_found", "session_not_found"); }, now: () => 2_000 });
  gone.enqueue(item());
  await gone.flush();
  assert.equal(gone.pending(), 0);
});

test("reading.recording: 7일 지난 파일은 버린다", async () => {
  const sent = [];
  const q = createRecordingQueue({ send: async (it) => void sent.push(it.requestId), now: () => 1_000 + RECORDING_KEEP_MS + 1 });
  q.enqueue(item({ requestId: "old", createdAt: 1_000 }));
  q.enqueue(item({ requestId: "new", createdAt: 1_000 + RECORDING_KEEP_MS }));
  await q.flush();
  assert.deepEqual(sent, ["new"]);
  assert.equal(RECORDING_KEEP_MS, 7 * 24 * 60 * 60 * 1000);
});

test("reading.recording: 같은 줄을 다시 말하면 시도 번호가 1 커지고, 저장된 회차의 녹음에서 이어 센다", () => {
  const counter = attemptCounter([{ line_id: "l-3", attempt_no: 2 }]);
  assert.equal(counter.next("l-1"), 1);
  assert.equal(counter.next("l-1"), 2);
  assert.equal(counter.next("l-3"), 3);
});

test("reading.recording: 저장 중인 녹음이 있으면 탭을 닫기 전에 알린다", () => {
  assert.equal(PENDING_UNLOAD_COPY, "저장 중인 녹음이 있어요");
  const listeners = [];
  const win = { addEventListener: (_n, cb) => listeners.push(cb), removeEventListener: () => {} };
  const q = createRecordingQueue({ send: async () => { throw new NetworkError(); }, now: () => 2_000, schedule: () => () => {}, window: win });
  q.enqueue(item());
  const ev = { preventDefault() { this.prevented = true; }, returnValue: "" };
  listeners[0](ev);
  assert.equal(ev.prevented, true);
  assert.equal(ev.returnValue, PENDING_UNLOAD_COPY);
});

const lines = [
  { type: "direction", text: "밤." },
  { type: "dialogue", role: "니나", text: "하나." },
  { type: "dialogue", role: "트레", text: "둘." },
  { type: "dialogue", role: "니나", text: "셋." },
  { type: "dialogue", role: "니나", text: "넷." },
];
const lineIds = ["l-0", "l-1", "l-2", "l-3", "l-4"];

test("reading.recording: 회차 상세는 \"내 대사 5개 중 2개 녹음 · 0:41 · 40%\" 처럼 요약하고, 이어 듣기는 줄 순서대로 튼다", () => {
  assert.equal(recordingSummary({ my_dialogue_count: 5, recorded_line_count: 2, elapsed_seconds: 41 }), "내 대사 5개 중 2개 녹음 · 0:41 · 40%");
  assert.equal(recordingSummary({ my_dialogue_count: 0, recorded_line_count: 0, elapsed_seconds: 0 }), "내 대사 0개 중 0개 녹음 · 0:00 · 0%");
  const recs = [
    { id: "r-b", line_id: "l-4", attempt_no: 1, duration_ms: 1000, content_type: "audio/mp4", byte_size: 1, transcript: null, transcript_source: "none", matched: null, playback_url: "https://cdn/4", playback_expires_at: "2026-09-21T04:00:00Z" },
    { id: "r-a", line_id: "l-1", attempt_no: 2, duration_ms: 1000, content_type: "audio/mp4", byte_size: 1, transcript: "하나", transcript_source: "stt", matched: true, playback_url: "https://cdn/1", playback_expires_at: "2026-09-21T04:00:00Z" },
  ];
  assert.deepEqual(playlistOf({ lines, lineIds }, recs).map((p) => [p.lineId, p.text, p.recording.id]), [["l-1", "하나.", "r-a"], ["l-4", "넷.", "r-b"]]);
});

test("reading.recording: 재생 주소는 만료 뒤에 쓰지 않는다 — 기기가 목록을 다시 조회한다", () => {
  const rec = { playback_url: "https://cdn/1", playback_expires_at: "2026-09-21T04:00:00Z" };
  assert.equal(playbackUrl(rec, new Date("2026-09-21T03:59:00Z")), "https://cdn/1");
  assert.equal(playbackUrl(rec, new Date("2026-09-21T04:11:00Z")), null);
  assert.equal(playbackUrl({ playback_url: null, playback_expires_at: null }, new Date()), null);
});
