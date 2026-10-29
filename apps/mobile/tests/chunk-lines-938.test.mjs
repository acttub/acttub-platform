import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { lineGroups, MAX_GROUP_LINES } from '../lib/reading/line-groups.ts';
import { monologueChunks } from '../lib/reading/monologue.ts';
import { createRun, turnSpan } from '../lib/reading/session-run.ts';

// SOMA-938 — 말풍선 줄 수는 서버(회차 응답 chunk_lines)가 정한다. 없으면 10.
const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const d = (role) => ({ id: 'x', type: 'dialogue', role, text: '대사' });

test('같은 배역 묶음은 받은 줄 수로 끊고, 없으면 10으로 끊는다', () => {
  const lines = Array.from({ length: 7 }, () => d('지성'));
  assert.deepEqual(lineGroups(lines, { monologue: false, maxLines: 3 }), [
    { start: 0, end: 2 },
    { start: 3, end: 5 },
    { start: 6, end: 6 },
  ]);
  assert.equal(MAX_GROUP_LINES, 10);
  assert.deepEqual(lineGroups(Array.from({ length: 11 }, () => d('지성')), { monologue: false }), [
    { start: 0, end: 9 },
    { start: 10, end: 10 },
  ]);
});

test('독백 말풍선도 받은 줄 수로 끊는다', () => {
  const lines = Array.from({ length: 7 }, () => d('하윤'));
  assert.deepEqual(monologueChunks(lines, 0, 6, 4), [
    { start: 0, end: 3 },
    { start: 4, end: 6 },
  ]);
});

test('리딩 실행은 회차의 chunkLines 로 내 차례(묶음)를 정한다', () => {
  const lines = Array.from({ length: 7 }, () => d('지성'));
  const run = createRun({ lines, lineIds: lines.map((_, i) => `l${i}`), myRoles: ['지성'], startIndex: 0, endIndex: 6, chunkLines: 3 });
  assert.deepEqual(turnSpan(run), { start: 0, end: 2 });
});

test('리딩 화면 — 회차 응답의 chunk_lines 를 실행 설정에 넣고, 말풍선·묶음에 같은 값을 쓴다', () => {
  const src = read('app/reading/play.tsx');
  assert.match(src, /chunkLines: session\.chunk_lines \?\? undefined,/);
  assert.match(src, /lineGroups\(run\.lines, \{ monologue, maxLines: run\.chunkLines \}\)/);
  assert.match(src, /monologueChunks\(run\.lines, run\.startIndex, run\.endIndex, run\.chunkLines\)/);
  assert.match(read('lib/reading/types.ts'), /chunk_lines\?: number;/);
});
