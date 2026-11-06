import assert from 'node:assert/strict';
import test from 'node:test';

import { NEXT_TAP_GUARD_MS, setNextTapGuardMs, tooSoonAfterLineChange } from '../lib/reading/next-tap-guard.ts';

test('줄이 바뀐 직후의 [다음]은 두 번 누름으로 보고 받지 않는다(11/5 문의 「대사가 씹힘」)', () => {
  setNextTapGuardMs(NEXT_TAP_GUARD_MS);
  assert.equal(tooSoonAfterLineChange(1_000, 1_000 + NEXT_TAP_GUARD_MS - 1), true);
  assert.equal(tooSoonAfterLineChange(1_000, 1_000 + NEXT_TAP_GUARD_MS), false);
  assert.ok(NEXT_TAP_GUARD_MS <= 1_000, '일부러 넘기는 손은 막지 않는다');
});

test('막기를 끄면 언제든 받는다', () => {
  setNextTapGuardMs(0);
  assert.equal(tooSoonAfterLineChange(1_000, 1_000), false);
  setNextTapGuardMs(NEXT_TAP_GUARD_MS);
});
