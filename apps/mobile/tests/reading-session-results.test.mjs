import assert from 'node:assert/strict';
import test from 'node:test';

import { quizSummary, readDialogueCount, reviewLines } from '../lib/reading/session-results.ts';

const D = (role, text) => ({ type: 'dialogue', role, text });
const X = (text) => ({ type: 'direction', text });
const LINES = [X('옥상'), D('윤서', '하나'), D('태오', '둘'), X('사이'), D('윤서', '셋'), D('태오', '넷'), D('윤서', '다섯')];
const IDS = LINES.map((_, i) => `l${i}`);

test('reading.session: 다시 볼 대사는 outcome이 unmatched·skipped인 줄이고 원문과 대사 번호만 있다', () => {
  const results = [
    { line_id: 'l1', outcome: 'passed', misses: 1 },
    { line_id: 'l4', outcome: 'unmatched', misses: 2 },
    { line_id: 'l6', outcome: 'skipped', misses: 0 },
  ];
  const review = reviewLines({ lines: LINES, lineIds: IDS, lineResults: results });
  assert.deepEqual(review, [
    { lineId: 'l4', dialogueNo: 3, role: '윤서', text: '셋', outcome: 'unmatched' },
    { lineId: 'l6', dialogueNo: 5, role: '윤서', text: '다섯', outcome: 'skipped' },
  ]);
  assert.deepEqual(reviewLines({ lines: LINES, lineIds: IDS, lineResults: [results[0]] }), [], 'unmatched·skipped가 없으면 절이 없다');
});

test('reading.session: quiz 완료는 "맞춘 줄 K / 시도 N · 아직 안 나온 줄 P" — K passed, N passed+unmatched, P skipped', () => {
  const results = [
    { line_id: 'l1', outcome: 'passed', misses: 1 },
    { line_id: 'l4', outcome: 'unmatched', misses: 2 },
    { line_id: 'l6', outcome: 'skipped', misses: 0 },
  ];
  assert.deepEqual(quizSummary(results), { matched: 1, tried: 2, notYet: 1 });
  assert.deepEqual(quizSummary([]), { matched: 0, tried: 0, notYet: 0 });
});

test('reading.session: 읽은 대사는 구간 안 대사 줄 수다(부분 구간을 대본 전체 완료로 말하지 않는다)', () => {
  assert.equal(readDialogueCount(LINES, 1, 6), 5);
  assert.equal(readDialogueCount(LINES, 4, 6), 3);
});
