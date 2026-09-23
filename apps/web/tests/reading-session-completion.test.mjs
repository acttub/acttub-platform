// reading.session — 완료 저장(complete: true)이 실패하면 같은 progress_seq·complete 요청을 오프라인 재시도와 같은 규칙으로 다시 보낸다.
// 성공 전에는 완료 화면이 "저장 중"을 보인다(조정자 지시, RW3).
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import "./ts-module-loader.mjs";
import { window } from "./dom-setup.mjs";

const { ApiError, NetworkError } = await import("../src/lib/api/v2/errors.ts");
const { createProgressSync } = await import("../src/lib/reading/session/progress.ts");
const { completionPending, resumeCompletionRetries, startCompletionRetry, subscribeCompletion, _resetCompletion } = await import(
  "../src/lib/reading/session/completion.ts"
);

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

beforeEach(() => {
  window.sessionStorage.clear();
  _resetCompletion();
});

test("reading.session: 완료 저장이 실패하면 마지막 요청 본문(같은 seq·complete)을 돌려주어 재시도에 넘길 수 있다", async () => {
  const sync = createProgressSync({ send: async () => { throw new NetworkError(); } });
  const answer = await sync.complete({ elapsedMs: 5_000, lineResults: [] });
  assert.equal(answer, null);
  assert.deepEqual(sync.lastRequest(), { progress_seq: 1, current_line_id: null, elapsed_seconds: 5, line_results: [], complete: true });
});

test("reading.session: 완료 재시도는 같은 본문을 늘어나는 간격으로 다시 보내고, 성공하면 저장 중 표시가 사라진다", async () => {
  const sent = [];
  let fail = true;
  const sch = fakeScheduler();
  const body = { progress_seq: 7, current_line_id: null, elapsed_seconds: 30, line_results: [], complete: true };
  const states = [];
  const unsubscribe = subscribeCompletion(() => states.push(completionPending("s-1")));
  startCompletionRetry("s-1", body, {
    send: async (id, b) => {
      sent.push([id, b]);
      if (fail) throw new NetworkError();
      return { current_line_id: null, elapsed_seconds: 30, progress_seq: 7, status: "completed" };
    },
    schedule: sch.schedule,
  });
  assert.equal(completionPending("s-1"), true);
  await sch.fire(); // 첫 시도
  assert.deepEqual(sch.delays(), [2_000]);
  await sch.fire();
  assert.deepEqual(sch.delays(), [4_000]);
  fail = false;
  await sch.fire();
  assert.equal(completionPending("s-1"), false);
  assert.equal(sent.length, 3);
  assert.deepEqual(sent[2], ["s-1", body]);
  assert.equal(states.at(-1), false);
  unsubscribe();
});

test("reading.session: 닫힌 회차(409 session_closed)와 404 는 더 보내지 않고 저장 중 표시를 거둔다", async () => {
  const sch = fakeScheduler();
  startCompletionRetry("s-2", { progress_seq: 1, current_line_id: null, elapsed_seconds: 1, line_results: [], complete: true }, {
    send: async () => { throw new ApiError(409, "session_closed", "session_closed"); },
    schedule: sch.schedule,
  });
  await sch.fire();
  assert.equal(completionPending("s-2"), false);
  assert.deepEqual(sch.delays(), []);
});

test("reading.session: 보내지 못한 완료 저장은 기기에 남아 다음 진입 때 다시 시도한다", async () => {
  const sch = fakeScheduler();
  startCompletionRetry("s-3", { progress_seq: 3, current_line_id: null, elapsed_seconds: 9, line_results: [], complete: true }, {
    send: async () => { throw new NetworkError(); },
    schedule: sch.schedule,
  });
  await sch.fire();
  assert.equal(completionPending("s-3"), true);
  // 새 페이지: 메모리는 비고 기기 저장소에서 되살린다.
  _resetCompletion(false);
  assert.equal(completionPending("s-3"), false);
  const sent = [];
  const sch2 = fakeScheduler();
  resumeCompletionRetries({
    send: async (id, b) => {
      sent.push([id, b.progress_seq]);
      return { current_line_id: null, elapsed_seconds: 9, progress_seq: 3, status: "completed" };
    },
    schedule: sch2.schedule,
  });
  assert.equal(completionPending("s-3"), true);
  await sch2.fire();
  assert.deepEqual(sent, [["s-3", 3]]);
  assert.equal(completionPending("s-3"), false);
});
