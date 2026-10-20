// reading.session — 완료 저장 재시도의 나머지 갈래. 기본 타이머로 보내기, 다시 시도해도 소용없는 오류, 같은 회차를 다시 시작,
// 이미 재시도 중인 회차를 다음 진입에서 겹쳐 시작하지 않기.
import assert from "node:assert/strict";
import { setTimeout as wait } from "node:timers/promises";
import { beforeEach, test } from "node:test";

import "./ts-module-loader.mjs";
import { window } from "./dom-setup.mjs";

const { completionPending, resumeCompletionRetries, startCompletionRetry, _resetCompletion } = await import(
  "../src/lib/reading/session/completion.ts"
);

const body = (seq) => ({ progress_seq: seq, complete: true, elapsed_ms: 1_000, line_results: [] });

function manualScheduler() {
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
      for (const t of timers.splice(0)) if (!t.cancelled) await t.fn();
    },
  };
}

beforeEach(() => {
  window.sessionStorage.clear();
  _resetCompletion();
});

test("reading.session: 타이머를 따로 주지 않으면 실제 타이머로 곧바로 보내고 성공하면 저장 중이 풀린다", async () => {
  const sent = [];
  startCompletionRetry("session-1", body(4), {
    send: async (id, b) => {
      sent.push([id, b]);
      return {};
    },
  });
  assert.equal(completionPending("session-1"), true);

  await wait(5);

  assert.deepEqual(sent, [["session-1", body(4)]]);
  assert.equal(completionPending("session-1"), false);
  assert.equal(window.sessionStorage.getItem("reading.pending_completions"), null);
});

test("reading.session: 네트워크·서버 오류가 아닌 실패는 다시 보내지 않고 저장 중을 거둔다", async () => {
  const timer = manualScheduler();
  let calls = 0;
  startCompletionRetry("session-1", body(4), {
    send: async () => {
      calls += 1;
      throw new TypeError("bad body");
    },
    schedule: timer.schedule,
  });

  await timer.fire();
  await timer.fire();

  assert.equal(calls, 1);
  assert.equal(completionPending("session-1"), false);
});

test("reading.session: 같은 회차의 완료 저장을 다시 시작하면 앞 예약은 취소되고 새 본문만 보낸다", async () => {
  const timer = manualScheduler();
  const sent = [];
  const deps = {
    send: async (_id, b) => {
      sent.push(b.progress_seq);
      return {};
    },
    schedule: timer.schedule,
  };

  startCompletionRetry("session-1", body(4), deps);
  startCompletionRetry("session-1", body(5), deps);
  await timer.fire();

  assert.deepEqual(sent, [5]);
});

test("reading.session: 이미 재시도 중인 회차는 다음 진입의 이어 시도에서 겹쳐 보내지 않는다", async () => {
  const timer = manualScheduler();
  const sent = [];
  const deps = {
    send: async (id, b) => {
      sent.push([id, b.progress_seq]);
      return {};
    },
    schedule: timer.schedule,
  };
  startCompletionRetry("session-1", body(9), deps);

  resumeCompletionRetries(deps);
  await timer.fire();

  assert.deepEqual(sent, [["session-1", 9]]);
});

test(
  "reading.session: 새 페이지에서 이어 시도 전에 다른 회차의 완료 저장이 실패해도 기기에 남아 있던 완료 저장을 잃지 않는다",
  async () => {
    const timer = manualScheduler();
    const sent = [];
    const deps = {
      send: async (id, b) => {
        sent.push([id, b.progress_seq]);
        return {};
      },
      schedule: timer.schedule,
    };
    window.sessionStorage.setItem("reading.pending_completions", JSON.stringify({ "session-2": body(2) }));

    startCompletionRetry("session-1", body(9), deps);
    resumeCompletionRetries(deps);
    await timer.fire();

    assert.deepEqual(sent, [
      ["session-1", 9],
      ["session-2", 2],
    ]);
  },
);
