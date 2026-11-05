import assert from 'node:assert/strict';
import test from 'node:test';

import { COMPRESS_HARD_MAX_MS, CompressTimeoutError, compressTimeoutMs, withProgressTimeout, withTimeout } from '../lib/compress-timeout.ts';

test('압축 상한은 영상 길이에 비례하고 8분을 넘지 않는다(SOMA-737)', () => {
  assert.equal(compressTimeoutMs(3), 51_000);
  assert.ok(compressTimeoutMs(60) > compressTimeoutMs(3));
  assert.equal(compressTimeoutMs(300), 8 * 60_000);
  assert.equal(compressTimeoutMs(null), 120_000);
});

test('withTimeout: 시간 안에 끝나면 결과를, 넘으면 취소 콜백과 함께 거절한다', async () => {
  assert.equal(await withTimeout(Promise.resolve('ok'), 50), 'ok');
  let cancelled = false;
  await assert.rejects(
    withTimeout(new Promise(() => {}), 20, () => (cancelled = true)),
    (e) => e instanceof CompressTimeoutError,
  );
  assert.ok(cancelled);
  await assert.rejects(withTimeout(Promise.reject(new Error('x')), 50), /x/);
});

test('withProgressTimeout: 진행률이 오르는 동안은 멈춤 상한을 넘겨도 기다린다(S23 2분 영상 실패, SOMA-737 후속)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let report;
  let finish;
  const result = withProgressTimeout(
    (onProgress) => {
      report = onProgress;
      return new Promise((resolve) => (finish = resolve));
    },
    { stallMs: 1_000, maxMs: 10_000 },
  );
  for (const progress of [0.2, 0.4, 0.6, 0.8]) {
    t.mock.timers.tick(900);
    report(progress);
  }
  t.mock.timers.tick(900);
  finish('done');
  assert.equal(await result, 'done');
});

test('withProgressTimeout: 진행률이 그대로면 멈춤 상한에서 취소하고 거절한다', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let report;
  let cancelled = false;
  const result = withProgressTimeout(
    (onProgress) => {
      report = onProgress;
      return new Promise(() => {});
    },
    { stallMs: 1_000, maxMs: 10_000 },
    () => (cancelled = true),
  );
  report(0.3);
  t.mock.timers.tick(600);
  report(0.3); // 같은 값은 진행이 아니다
  t.mock.timers.tick(500);
  await assert.rejects(result, (e) => e instanceof CompressTimeoutError);
  assert.ok(cancelled);
});

test('withProgressTimeout: 진행 중이어도 전체 상한을 넘기면 끊는다', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let report;
  const result = withProgressTimeout(
    (onProgress) => {
      report = onProgress;
      return new Promise(() => {});
    },
    { stallMs: 1_000, maxMs: 3_000 },
  );
  for (let i = 1; i <= 4; i += 1) {
    t.mock.timers.tick(800);
    report(i / 10);
  }
  await assert.rejects(result, (e) => e instanceof CompressTimeoutError);
});

test('withProgressTimeout: 압축이 먼저 실패하면 그 오류를 그대로 낸다', async () => {
  await assert.rejects(withProgressTimeout(() => Promise.reject(new Error('codec')), { stallMs: 50, maxMs: 100 }), /codec/);
});

test('전체 상한은 길이로 정한 멈춤 상한보다 길다', () => {
  assert.ok(COMPRESS_HARD_MAX_MS > compressTimeoutMs(300));
});

test('withProgressTimeout: 압축을 시작하자마자 던져도 거절로 받는다', async () => {
  await assert.rejects(
    withProgressTimeout(() => { throw new Error('no codec'); }, { stallMs: 50, maxMs: 100 }),
    /no codec/,
  );
});
