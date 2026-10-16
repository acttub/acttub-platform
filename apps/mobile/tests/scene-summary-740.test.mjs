import assert from 'node:assert/strict';
import test from 'node:test';

import { summaryRows } from '../lib/practice/scene-summary.ts';

const EMPTY = { situation: '', character: '', goal: '' };

test('SOMA-740: 입력받은 제목과 막힌 곳만 보이고 빈 상황·인물·목표 줄은 뺀다', () => {
  const rows = summaryRows({ title: ' 이별 장면 ', scene: EMPTY, blockageKind: '표현' });
  assert.deepEqual(rows, [
    { key: 'title', value: '이별 장면' },
    { key: 'blockage', value: '표현' },
  ]);
});

test('SOMA-740: 예전 연습처럼 장면 값이 있으면 그대로 보인다', () => {
  const rows = summaryRows({ scene: { situation: '카페', character: '', goal: '붙잡기' }, blockageKind: null });
  assert.deepEqual(rows.map((r) => r.key), ['situation', 'goal']);
});

test('SOMA-740: 아무 값도 없으면 줄이 없다', () => {
  assert.deepEqual(summaryRows({ title: null, scene: EMPTY }), []);
});
