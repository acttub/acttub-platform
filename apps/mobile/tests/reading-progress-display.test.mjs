import assert from 'node:assert/strict';
import { test } from 'node:test';

const p = await import('../lib/reading/progress-display.ts');

function store(initial = null, failSet = false) {
  let v = initial;
  return {
    async getItem() { return v; },
    async setItem(_k, next) { if (failSet) throw new Error('full'); v = next; },
    peek: () => v,
  };
}

test('끝까지 간 회차를 기억하고 지우며, 깨진 값·저장 실패는 조용히 넘긴다', async () => {
  const s = store();
  assert.equal(await p.hasReachedEnd('r1', s), false);
  await p.markReachedEnd('r1', s);
  await p.markReachedEnd('r1', s);
  assert.equal(await p.hasReachedEnd('r1', s), true);
  assert.deepEqual(JSON.parse(s.peek()), ['r1']);
  await p.clearReachedEnd('r1', s);
  assert.equal(await p.hasReachedEnd('r1', s), false);
  await p.clearReachedEnd('missing', s);

  assert.equal(await p.hasReachedEnd('r1', store('{broken')), false);
  assert.equal(await p.hasReachedEnd('r1', store('"text"')), false);
  await p.markReachedEnd('r2', store(null, true));
});

test('끝까지 간 회차는 done 을 total 로 올리고, 남은 시간은 줄당 평균으로 올림한다', () => {
  assert.deepEqual(p.displayProgress({ done: 9, total: 10 }, true), { done: 10, total: 10 });
  assert.deepEqual(p.displayProgress({ done: 9, total: 10 }, false), { done: 9, total: 10 });
  assert.deepEqual(p.displayProgress({ done: 0, total: 0 }, true), { done: 0, total: 0 });

  assert.equal(p.secPerLine([]), p.DEFAULT_SEC_PER_LINE);
  const range = (a, b) => ({ start_dialogue_no: a, end_dialogue_no: b });
  assert.equal(
    p.secPerLine([
      { status: 'completed', range: range(1, 10), elapsed_seconds: 60 },
      { status: 'completed', range: range(1, 5), elapsed_seconds: 40 },
      { status: 'in_progress', range: range(1, 10), elapsed_seconds: 999 },
      { status: 'completed', range: range(1, 10), elapsed_seconds: 0 },
    ]),
    7,
  );
  assert.equal(p.remainingMinutes({ done: 3, total: 10 }, 4), 1);
  assert.equal(p.remainingMinutes({ done: 0, total: 40 }, 6), 4);
  assert.equal(p.remainingMinutes({ done: 10, total: 10 }, 4), null);
});
