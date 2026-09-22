import assert from 'node:assert/strict';
import test from 'node:test';

import {
  TARGET,
  clearTargetRect,
  onTargetsChanged,
  registerMeasure,
  remeasureTargets,
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

test('가이드를 띄울 때 맡겨 둔 자리를 다시 잰다 — 첫 배치 값은 제자리가 아닐 수 있다', () => {
  let measured = 0;
  const off = registerMeasure(TARGET.homeStart, () => {
    measured += 1;
    setTargetRect(TARGET.homeStart, { x: 20, y: 330, width: 350, height: 72 });
  });
  // 첫 배치에서 화면 맨 위로 잘못 잡혀 있었다고 하자.
  setTargetRect(TARGET.homeStart, { x: 20, y: 0, width: 350, height: 72 });
  remeasureTargets();
  assert.equal(measured, 1);
  assert.equal(targetRect(TARGET.homeStart).y, 330);
  off();
  remeasureTargets();
  assert.equal(measured, 1);
  clearTargetRect(TARGET.homeStart);
});

test('이름표는 서로 다르다', () => {
  const names = Object.values(TARGET);
  assert.equal(new Set(names).size, names.length);
});
