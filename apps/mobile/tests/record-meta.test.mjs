import assert from 'node:assert/strict';
import test from 'node:test';

import { loadRecordMeta, toRecordMeta } from '../lib/record-meta.ts';

test('F11: 연습 카드가 분석인지 표현인지를 뽑는다', () => {
  assert.deepEqual(toRecordMeta({ report: { report_type: 'analysis' } }), {
    kind: '분석',
    start: '',
    end: '',
  });
  assert.deepEqual(toRecordMeta({ report: { report_type: 'expression' } }), {
    kind: '표현',
    start: '',
    end: '',
  });
});

test('F11: 필드가 비어도 빈 meta로 떨어진다', () => {
  const empty = { kind: '', start: '', end: '' };
  assert.deepEqual(toRecordMeta(null), empty);
  assert.deepEqual(toRecordMeta({ report: null }), empty);
  // 막힌 카드(blocked)는 분석·표현 어느 쪽도 아니라 칩을 붙이지 않는다.
  assert.deepEqual(toRecordMeta({ report: { report_type: 'blocked' } }), empty);
});

test('F11: 모든 기록의 meta를 id별로 채운다', async () => {
  const meta = await loadRecordMeta(['a', 'b'], async (id) => ({
    report: { report_type: id === 'a' ? 'analysis' : 'expression' },
  }));

  assert.deepEqual(Object.keys(meta).sort(), ['a', 'b']);
  assert.equal(meta.a.kind, '분석');
  assert.equal(meta.b.kind, '표현');
});

test('F11: 하나가 실패해도 나머지는 채워진다', async () => {
  const meta = await loadRecordMeta(['ok', 'fail'], async (id) => {
    if (id === 'fail') throw new Error('404');
    return { report: { report_type: 'analysis' } };
  });

  assert.equal(meta.ok.kind, '분석');
  assert.deepEqual(meta.fail, { kind: '', start: '', end: '' });
});

test('F11: 동시 실행 수를 넘지 않는다', async () => {
  let running = 0;
  let peak = 0;
  const ids = Array.from({ length: 10 }, (_, i) => `id-${i}`);

  await loadRecordMeta(
    ids,
    async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setImmediate(resolve));
      running -= 1;
      return { report: { report_type: 'analysis' } };
    },
    3,
  );

  assert.ok(peak <= 3, `동시 실행이 ${peak}개까지 올라갔다`);
});

test('F11: 빈 목록이면 요청하지 않는다', async () => {
  let calls = 0;
  const meta = await loadRecordMeta([], async () => {
    calls += 1;
    return {};
  });
  assert.deepEqual(meta, {});
  assert.equal(calls, 0);
});
