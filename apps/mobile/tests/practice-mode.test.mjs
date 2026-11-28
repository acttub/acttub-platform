import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isPracticeMode, practiceHref } from '../lib/practice-mode.ts';

test('모드 판별과 연습 탭 주소', () => {
  assert.equal(isPracticeMode('reading'), true);
  assert.equal(isPracticeMode('coaching'), true);
  assert.equal(isPracticeMode('practice'), false);
  assert.equal(isPracticeMode(undefined), false);
  assert.equal(practiceHref('reading'), '/practice?mode=reading');
  assert.equal(practiceHref('coaching'), '/practice?mode=coaching');
});
