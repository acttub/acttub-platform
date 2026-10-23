import assert from 'node:assert/strict';
import test from 'node:test';

import { SAMPLE_SCRIPTS, dialogueCount } from '../lib/reading/sample.ts';
import { displayProgress, remainingMinutes, secPerLine } from '../lib/reading/progress-display.ts';
import { freeLeft } from '../lib/script-cocreate.ts';

test('예시 대본 세 편의 모양', () => {
  assert.equal(SAMPLE_SCRIPTS.length, 3);
  const cafe = SAMPLE_SCRIPTS[1];
  assert.ok(dialogueCount(cafe) >= 12 && dialogueCount(cafe) <= 16);
  const minji = SAMPLE_SCRIPTS[2];
  assert.equal(dialogueCount(minji), 0);
  const body = minji.text.split('\n').slice(1).filter((l) => l.trim() && !l.trim().startsWith('('));
  assert.equal(body.join(' ').split(/(?<=[.?!])\s+/).length >= 6, true);
});

test('끝 줄까지 갔다고 남긴 회차는 N/N 으로 보인다', () => {
  assert.deepEqual(displayProgress({ done: 9, total: 10 }, true), { done: 10, total: 10 });
  assert.deepEqual(displayProgress({ done: 9, total: 10 }, false), { done: 9, total: 10 });
});

test('남은 시간은 남은 줄 × 줄당 평균 초, 기록이 없으면 4초', () => {
  assert.equal(secPerLine([]), 4);
  assert.equal(secPerLine([{ status: 'completed', elapsed_seconds: 60, range: { start_dialogue_no: 1, end_dialogue_no: 10 } }]), 6);
  assert.equal(remainingMinutes({ done: 0, total: 30 }, 4), 2);
  assert.equal(remainingMinutes({ done: 9, total: 10 }, 4), 1);
  assert.equal(remainingMinutes({ done: 10, total: 10 }, 4), null);
});

test('다시 만들기 남은 횟수', () => {
  assert.equal(freeLeft(2, 0), 2);
  assert.equal(freeLeft(undefined, 1), 2);
  assert.equal(freeLeft(3, 3), 0);
});
