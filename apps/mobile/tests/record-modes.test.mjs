import assert from 'node:assert/strict';
import test from 'node:test';

import { recordModes, recordModeAfterSwipe } from '../lib/record-modes.ts';

/**
 * 촬영 화면 아래 모드 슬라이드 (SOMA-494, 인스타 만들기 화면처럼).
 * 가운데 버튼을 누르면 카메라가 바로 열리고, 아래에서 옆으로 넘겨 용도를 고른다.
 */
test('모드는 AI 코칭이 먼저고, 오늘의 대사는 한국어일 때만 끼운다', () => {
  assert.deepEqual(recordModes(true), ['ai', 'challenge', 'plain']);
  assert.deepEqual(recordModes(false), ['ai', 'plain']);
});

test('옆으로 넘기면 이웃 모드로 가고, 끝에서는 멈춘다', () => {
  const modes = recordModes(true);
  assert.equal(recordModeAfterSwipe(modes, 'ai', 'left'), 'challenge');
  assert.equal(recordModeAfterSwipe(modes, 'challenge', 'left'), 'plain');
  assert.equal(recordModeAfterSwipe(modes, 'plain', 'left'), 'plain');
  assert.equal(recordModeAfterSwipe(modes, 'challenge', 'right'), 'ai');
  assert.equal(recordModeAfterSwipe(modes, 'ai', 'right'), 'ai');
});
