import assert from 'node:assert/strict';
import test from 'node:test';

import {
  analysisFailureMessage,
  analysisPushTarget,
  cancelAnalysis,
  watchAnalysis,
} from '../lib/practice/analysis-run.ts';

const analyzing = { stage: 'analyzing', job: { status: 'running', failure_reason: null }, analysis_status: null, close_reason: null };
const ready = { stage: 'conversing', job: { status: 'succeeded', failure_reason: null }, analysis_status: 'complete', close_reason: null };

test('practice.analyze: 이미 떠난 화면이면 조회하지 않는다', async () => {
  const controller = new AbortController();
  controller.abort();
  const reads = [];
  const outcome = await watchAnalysis('p-1', controller.signal, {
    getStatus: async (id) => { reads.push(id); return ready; },
    delay: async () => {},
  });
  assert.deepEqual(outcome, { kind: 'stopped' });
  assert.deepEqual(reads, []);
});

test('practice.analyze: 기다리는 중에 떠나면(지연이 중단되거나 끝난 뒤 떠난 상태면) 더 읽지 않는다', async () => {
  for (const leave of ['delay throws', 'aborted after delay']) {
    const controller = new AbortController();
    const reads = [];
    const outcome = await watchAnalysis('p-2', controller.signal, {
      getStatus: async (id) => { reads.push(id); return analyzing; },
      delay: async () => {
        controller.abort();
        if (leave === 'delay throws') throw new Error('aborted');
      },
    });
    assert.deepEqual(outcome, { kind: 'stopped' }, leave);
    assert.deepEqual(reads, ['p-2'], leave);
  }
});

test('practice.analyze: 조회가 끝나기 전에 떠나면 성공·실패와 상관없이 멈춘 것으로 본다', async () => {
  for (const fails of [true, false]) {
    const controller = new AbortController();
    const seen = [];
    const outcome = await watchAnalysis('p-3', controller.signal, {
      getStatus: async () => {
        controller.abort();
        if (fails) throw new Error('offline');
        return ready;
      },
      delay: async () => {},
      onStatus: (status) => seen.push(status),
    });
    assert.deepEqual(outcome, { kind: 'stopped' });
    assert.deepEqual(seen, [], '떠난 화면에 상태를 넘기지 않는다');
  }
});

test('practice.analyze: 회차가 닫혔는데 작업 사유가 없으면 회차 사유로, 둘 다 없으면 사유 없이 실패다', async () => {
  const run = (status) =>
    watchAnalysis('p-4', new AbortController().signal, { getStatus: async () => status, delay: async () => {} });
  assert.deepEqual(await run({ stage: 'closed', job: null, analysis_status: null, close_reason: 'account_deactivated' }), {
    kind: 'failed',
    reason: 'account_deactivated',
    retriable: false,
  });
  assert.deepEqual(await run({ stage: 'closed', job: null, analysis_status: null, close_reason: null }), {
    kind: 'failed',
    reason: null,
    retriable: true,
  });
});

test('practice.analyze: 간격을 주지 않으면 4초마다 읽는다', async () => {
  const waits = [];
  const statuses = [analyzing, ready];
  const outcome = await watchAnalysis('p-5', new AbortController().signal, {
    getStatus: async () => statuses.shift(),
    delay: async (ms) => { waits.push(ms); },
  });
  assert.deepEqual(outcome, { kind: 'ready', analysis: 'complete' });
  assert.deepEqual(waits, [4_000]);
});

test('practice.analyze: 실패 사유마다 사람 말로 알린다', () => {
  assert.deepEqual(
    ['timeout', 'parse', 'unsupported', 'cancelled', 'account_deactivated', 'gpu_lost', null].map(analysisFailureMessage),
    [
      '분석 시간이 초과됐어요. 영상을 더 짧게 잘라서 다시 시도해주세요.',
      '분석 결과를 정리하지 못했어요. 다시 시도해주세요.',
      '지원하지 않는 영상 형식이에요. mp4로 다시 올려주세요.',
      '분석을 그만뒀어요. 영상은 그대로 있어요.',
      '계정이 종료돼 분석을 마치지 못했어요.',
      '분석에 실패했어요. 다시 시도해주세요.',
      '분석에 실패했어요. 다시 시도해주세요.',
    ],
  );
});

test('practice.analyze: 회차가 없으면(404) 취소할 것이 없고, 그 밖의 오류는 그대로 올린다', async () => {
  assert.equal(
    await cancelAnalysis('p-6', async () => { throw Object.assign(new Error('gone'), { status: 404 }); }),
    'already_done',
  );
  const serverError = Object.assign(new Error('boom'), { status: 500 });
  await assert.rejects(cancelAnalysis('p-6', async () => { throw serverError; }), serverError);
  await assert.rejects(cancelAnalysis('p-6', async () => { throw null; }), (error) => error === null);
  await assert.rejects(cancelAnalysis('p-6', async () => { throw 'offline'; }), (error) => error === 'offline');
});

test('practice.analyze: 완료 푸시에 회차 id 가 비었거나 글자가 아니면 무시한다', () => {
  assert.equal(analysisPushTarget({ kind: 'analysis_complete', practice_id: '' }), null);
  assert.equal(analysisPushTarget({ kind: 'analysis_complete', practice_id: 7 }), null);
  assert.equal(analysisPushTarget('analysis_complete'), null);
});
