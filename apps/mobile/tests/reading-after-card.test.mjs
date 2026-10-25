import assert from 'node:assert/strict';
import test from 'node:test';

import { markSegments, markedLineCount, pronunciationSettled } from '../lib/reading/pronunciation-report.ts';
import { recordingCoachFailure, recordingCoachOnFromProbe } from '../lib/reading/recording-coach.ts';

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

test('녹음 액티: 없는 대화 물음의 오류 코드로 켜짐을 본다(SOMA-791)', () => {
  assert.equal(recordingCoachOnFromProbe({ code: 'recording_coach_not_found' }), true);
  assert.equal(recordingCoachOnFromProbe({ code: 'Not Found' }), false);
  assert.equal(recordingCoachOnFromProbe(new Error('network')), false);
  assert.equal(recordingCoachFailure({ code: 'recording_coach_not_enough_audio' }), 'not_enough_audio');
  assert.equal(recordingCoachFailure({ code: 'recording_coach_unavailable' }), 'unavailable');
  assert.equal(recordingCoachFailure({ code: 'session_not_found' }), 'gone');
  assert.equal(recordingCoachFailure({ code: 'network_error' }), 'other');
});
