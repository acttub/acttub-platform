import assert from 'node:assert/strict';
import test from 'node:test';

import { CompressTimeoutError, compressTimeoutMs, withTimeout } from '../lib/compress-timeout.ts';

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
