import assert from 'node:assert/strict';
import test from 'node:test';

import {
  TARGET,
  clearTargetRect,
  onTargetsChanged,
  setTargetRect,
  targetRect,
} from '../lib/spotlight-targets.ts';

/** 가이드가 비출 자리를 화면 밖으로 주고받는다 (SOMA-550). */

test('아직 안 그려진 자리는 없다', () => {
  assert.equal(targetRect('없는.이름표'), null);
});

test('적은 자리를 이름표로 꺼낸다', () => {
  setTargetRect(TARGET.homeStart, { x: 20, y: 300, width: 350, height: 72 });
  assert.deepEqual(targetRect(TARGET.homeStart), { x: 20, y: 300, width: 350, height: 72 });
  clearTargetRect(TARGET.homeStart);
  assert.equal(targetRect(TARGET.homeStart), null);
});

test('자리가 바뀌면 알려 준다', () => {
  let calls = 0;
  const off = onTargetsChanged(() => {
    calls += 1;
  });
  setTargetRect(TARGET.shoot, { x: 0, y: 0, width: 58, height: 58 });
  assert.equal(calls, 1);
  // 같은 자리를 다시 적어도 알리지 않는다 — 다시 그릴 일이 없다.
  setTargetRect(TARGET.shoot, { x: 0, y: 0, width: 58, height: 58 });
  assert.equal(calls, 1);
  setTargetRect(TARGET.shoot, { x: 0, y: 10, width: 58, height: 58 });
  assert.equal(calls, 2);
  off();
  setTargetRect(TARGET.shoot, { x: 0, y: 20, width: 58, height: 58 });
  assert.equal(calls, 2);
  clearTargetRect(TARGET.shoot);
});

test('이름표는 서로 다르다', () => {
  const names = Object.values(TARGET);
  assert.equal(new Set(names).size, names.length);
});
