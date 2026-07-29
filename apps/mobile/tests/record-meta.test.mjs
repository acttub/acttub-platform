import assert from 'node:assert/strict';
import test from 'node:test';

import { loadRecordMeta, toRecordMeta } from '../lib/record-meta.ts';

test('F11: 상세 응답에서 진단 축과 구간을 뽑는다', () => {
  assert.deepEqual(
    toRecordMeta({
      report: { biggest_problem: { dimension: '템포·시선', start: '0:12', end: '0:20' } },
    }),
    { dimension: '템포·시선', start: '0:12', end: '0:20' },
  );
});

test('F11: 필드가 비어도 빈 meta로 떨어진다', () => {
  assert.deepEqual(toRecordMeta(null), { dimension: '', start: '', end: '' });
  assert.deepEqual(toRecordMeta({ report: null }), { dimension: '', start: '', end: '' });
  assert.deepEqual(toRecordMeta({ report: { biggest_problem: null } }), {
    dimension: '',
    start: '',
    end: '',
  });
});

test('F11: 모든 기록의 meta를 id별로 채운다', async () => {
  const meta = await loadRecordMeta(['a', 'b'], async (id) => ({
    report: { biggest_problem: { dimension: `축-${id}`, start: '0:01', end: '0:02' } },
  }));

  assert.deepEqual(Object.keys(meta).sort(), ['a', 'b']);
  assert.equal(meta.a.dimension, '축-a');
  assert.equal(meta.b.dimension, '축-b');
});

test('F11: 하나가 실패해도 나머지는 채워진다', async () => {
  const meta = await loadRecordMeta(['ok', 'fail'], async (id) => {
    if (id === 'fail') throw new Error('404');
    return { report: { biggest_problem: { dimension: '템포', start: '0:03', end: '0:05' } } };
  });

  assert.equal(meta.ok.dimension, '템포');
  assert.deepEqual(meta.fail, { dimension: '', start: '', end: '' });
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
      return { report: { biggest_problem: { dimension: 'x', start: '', end: '' } } };
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
