import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PRACTICE_POLL_INTERVAL_MS,
  analysisPartialNotice,
  analysisPushTarget,
  cancelAnalysis,
  watchAnalysis,
} from '../lib/practice/analysis-run.ts';

const status = (job, analysis = null, reason = null) => ({
  stage: job === 'succeeded' ? 'conversing' : job === 'failed' ? 'closed' : 'analyzing',
  job: { status: job, failure_reason: reason },
  analysis: analysis ? { status: analysis } : null,
});

/** 기다린 시간을 적어 두는 가짜 지연 — 실제로 기다리지 않는다. */
function recorder() {
  const waits = [];
  return {
    waits,
    delay: async (ms, signal) => {
      if (signal?.aborted) throw new Error('aborted');
      waits.push(ms);
    },
  };
}

test('practice.analyze: 앱은 4초 간격으로 상태를 읽고 pending → running → succeeded 뒤 결과를 받는다', async () => {
  const seen = [];
  const { waits, delay } = recorder();
  const queue = [status('pending'), status('running'), status('succeeded', 'ready')];

  const outcome = await watchAnalysis('practice-1', new AbortController().signal, {
    getStatus: async () => queue.shift(),
    delay,
    onStatus: (s) => seen.push(s.job.status),
  });

  assert.deepEqual(outcome, { kind: 'ready', analysis: 'ready' });
  assert.deepEqual(seen, ['pending', 'running', 'succeeded']);
  // 첫 조회는 기다리지 않는다 — 들어오자마자 서버 상태부터 읽는다.
  assert.deepEqual(waits, [PRACTICE_POLL_INTERVAL_MS, PRACTICE_POLL_INTERVAL_MS]);
  assert.equal(PRACTICE_POLL_INTERVAL_MS, 4_000);
});

test('practice.analyze: 부분 완료는 대화를 시작하고 못 본 구간을 알린다', async () => {
  const { delay } = recorder();

  const outcome = await watchAnalysis('practice-2', new AbortController().signal, {
    getStatus: async () => status('succeeded', 'partial'),
    delay,
  });

  assert.deepEqual(outcome, { kind: 'ready', analysis: 'partial' });
  assert.equal(typeof analysisPartialNotice('partial'), 'string');
  assert.equal(analysisPartialNotice('ready'), null);
});

test('practice.analyze: 3회 소진으로 실패하면 다시 시도할 수 있고 취소는 다시 시도가 아니다', async () => {
  const { delay } = recorder();

  const failed = await watchAnalysis('practice-3', new AbortController().signal, {
    getStatus: async () => status('failed', null, 'timeout'),
    delay,
  });
  assert.deepEqual(failed, { kind: 'failed', reason: 'timeout', retriable: true });

  const cancelled = await watchAnalysis('practice-3', new AbortController().signal, {
    getStatus: async () => status('failed', null, 'cancelled'),
    delay,
  });
  assert.deepEqual(cancelled, { kind: 'failed', reason: 'cancelled', retriable: false });
});

test('practice.analyze: 화면을 떠나면 조회만 멈추고 돌아오면 서버 상태부터 읽는다', async () => {
  const controller = new AbortController();
  const { waits, delay } = recorder();
  let calls = 0;

  const left = await watchAnalysis('practice-4', controller.signal, {
    getStatus: async () => {
      calls += 1;
      controller.abort(); // 첫 조회 직후 화면을 떠난다
      return status('running');
    },
    delay,
  });

  assert.deepEqual(left, { kind: 'stopped' });
  assert.equal(calls, 1);
  assert.deepEqual(waits, []);

  // 돌아오면 기다리지 않고 바로 읽는다 — 그 사이 작업은 끝나 있었다.
  const back = recorder();
  const resumed = await watchAnalysis('practice-4', new AbortController().signal, {
    getStatus: async () => status('succeeded', 'ready'),
    delay: back.delay,
  });
  assert.deepEqual(resumed, { kind: 'ready', analysis: 'ready' });
  assert.deepEqual(back.waits, []);
});

test('practice.analyze: 조회가 한두 번 끊겨도 이어 보고 연속 세 번이면 오류로 본다', async () => {
  const { delay } = recorder();
  const results = [
    () => { throw new Error('네트워크'); },
    () => status('running'),
    () => { throw new Error('네트워크'); },
    () => { throw new Error('네트워크'); },
    () => { throw new Error('네트워크'); },
  ];

  const outcome = await watchAnalysis('practice-5', new AbortController().signal, {
    getStatus: async () => results.shift()(),
    delay,
  });

  assert.equal(outcome.kind, 'error');
});

test('practice.analyze: "그만두기"는 작업을 취소하고 이미 끝났으면 취소할 것이 없다', async () => {
  const calls = [];
  assert.equal(
    await cancelAnalysis('practice-6', async (id) => {
      calls.push(id);
    }),
    'cancelled',
  );
  assert.deepEqual(calls, ['practice-6']);

  assert.equal(
    await cancelAnalysis('practice-6', async () => {
      throw Object.assign(new Error('already'), { status: 409 });
    }),
    'already_done',
  );
});

test('practice.analyze: 완료 푸시에서 회차 id를 읽는다', () => {
  assert.deepEqual(analysisPushTarget({ kind: 'analysis_complete', practice_id: 'practice-7' }), {
    practiceId: 'practice-7',
  });
  assert.deepEqual(analysisPushTarget({ type: 'analysis_complete', practice_id: 'practice-7' }), {
    practiceId: 'practice-7',
  });
  assert.equal(analysisPushTarget({ kind: 'challenge_like', practice_id: 'practice-7' }), null);
  assert.equal(analysisPushTarget(null), null);
});
