import assert from 'node:assert/strict';
import test from 'node:test';

import { markSegments, markedLineCount, pronunciationSettled } from '../lib/reading/pronunciation-report.ts';
import { readingNextLine, voiceCoachCardState } from '../lib/reading/voice-coaching.ts';

const mark = (index, word) => ({ index, word, lpr: -4, startMs: 100, endMs: 300 });

test('발음 보고서: 서버 어절 순서로 칠하고 띄어쓰기·문장부호는 칠하지 않고 그대로 둔다(SOMA-606)', () => {
  const segs = markSegments('그럼, 내가 힘들면 어떡해?', [mark(1, '내가'), mark(2, '힘들면')]);
  assert.deepEqual(segs, [
    { text: '그럼, ', marked: false },
    { text: '내가', marked: true },
    { text: ' ', marked: false },
    { text: '힘들면', marked: true },
    { text: ' 어떡해?', marked: false },
  ]);
});

test('발음 보고서: 순서가 어긋나면 같은 글자의 첫 어절을 칠하고, 못 찾으면 칠하지 않는다', () => {
  assert.deepEqual(markSegments('가자 집에', [mark(5, '집에')]), [
    { text: '가자 ', marked: false },
    { text: '집에', marked: true },
  ]);
  assert.deepEqual(markSegments('가자 집에', [mark(0, '없는말')]), [{ text: '가자 집에', marked: false }]);
});

test('발음 보고서: 칠한 줄 수와 기다림 끝 상태', () => {
  const report = { lines: [{ lineNo: 1, text: 'a', marks: [mark(0, 'a')] }, { lineNo: 2, text: 'b', marks: [] }] };
  assert.equal(markedLineCount(report), 1);
  assert.equal(markedLineCount({}), 0);
  assert.equal(pronunciationSettled('running'), false);
  assert.equal(pronunciationSettled('skipped'), true);
});

test('리딩 녹음 코칭 카드: available 참일 때만 보이고 거짓·오류(null)는 숨기며 이미 시작한 회차를 알려 준다(SOMA-791)', () => {
  assert.deepEqual(voiceCoachCardState({ available: true, practice_id: null }), { show: true, practiceId: null });
  assert.deepEqual(voiceCoachCardState({ available: true, practice_id: 'p1' }), { show: true, practiceId: 'p1' });
  assert.deepEqual(voiceCoachCardState({ available: false, practice_id: null }), { show: false, practiceId: null });
  assert.deepEqual(voiceCoachCardState(null), { show: false, practiceId: null });
  assert.deepEqual(voiceCoachCardState(undefined), { show: false, practiceId: null });
});

test('리딩 녹음 코칭: 끝에 영상으로 찍을 줄은 card.next.text 의 첫 따옴표 안 글이다', () => {
  const base = { purpose: 'reading', step: 'wrap', choices: [], scene: null, lines: [{ at: null, text: '무시' }], card: null, character_card: null };
  const next = (text) => ({ ...base, card: { good: null, issue: null, next: { at: null, text } } });
  assert.equal(readingNextLine(next('"가자"에서 끝을 내려 봐요')), '가자');
  assert.equal(readingNextLine(next('“그만 가, 제발”에서 천천히 “둘째” 말해요')), '그만 가, 제발');
  assert.equal(readingNextLine(next('따옴표 없이 해 봐요')), null);
  assert.equal(readingNextLine(base), null);
  assert.equal(readingNextLine({ ...next('"x"에서'), purpose: 'stuck' }), null);
  assert.equal(readingNextLine(null), null);
});
