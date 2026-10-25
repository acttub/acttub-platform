import assert from 'node:assert/strict';
import { test } from 'node:test';

import { memoryStorage } from './helpers/stub-modules.mjs';

const storage = memoryStorage();
let broken = false;
globalThis.require = () => {
  if (broken) throw new Error('native module missing');
  return { default: storage };
};
const { hasGraduatedFirstUse, markFirstUseGraduated } = await import('../lib/practice/first-use-graduation.ts');
const { firstTimeStateFrom, getFirstTimeState, setFirstTimeState } = await import('../lib/practice/first-time.ts');

test('끝까지 해 본 계정은 기기에 졸업 표시를 남긴다 — 계정마다 따로(SOMA-827)', async () => {
  assert.equal(await hasGraduatedFirstUse('u1'), false);
  setFirstTimeState('first');
  await markFirstUseGraduated('u1');
  assert.equal(await hasGraduatedFirstUse('u1'), true);
  // 같은 폰의 다른 계정은 아직이다.
  assert.equal(await hasGraduatedFirstUse('u2'), false);
  // 표시하는 순간 탭바도 바로 보이게 한다(홈에 돌아오기 전이라도).
  assert.equal(getFirstTimeState(), 'practiced');
  setFirstTimeState('unknown');
});

test('계정을 모르면 남기지 않고, 저장소를 못 쓰면 졸업 안 한 것으로 본다', async () => {
  storage.values.clear();
  await markFirstUseGraduated(null);
  assert.equal(storage.values.size, 0);
  assert.equal(await hasGraduatedFirstUse(null), false);
  broken = true;
  await markFirstUseGraduated('u1');
  assert.equal(await hasGraduatedFirstUse('u1'), false);
  broken = false;
});

test('기기 졸업 표시가 있으면 서버 기록이 비어도 첫 사용자가 아니다', () => {
  const base = { loaded: true, groupsFailed: false, groups: [], scripts: [], practicedDays: 0 };
  assert.equal(firstTimeStateFrom(base), 'first');
  assert.equal(firstTimeStateFrom({ ...base, graduated: true }), 'practiced');
  assert.equal(firstTimeStateFrom({ ...base, groupsFailed: true, graduated: true }), 'practiced');
  assert.equal(firstTimeStateFrom({ ...base, loaded: false, graduated: true }), 'unknown');
});

test('계정을 넘기지 않으면 로그인 상태가 알려 준 지금 계정으로 읽고 남긴다', async () => {
  const { setFirstUseOwner } = await import('../lib/practice/first-use-graduation.ts');
  storage.values.clear();
  setFirstUseOwner('u9');
  assert.equal(await hasGraduatedFirstUse(), false);
  await markFirstUseGraduated();
  assert.equal(await hasGraduatedFirstUse(), true);
  assert.equal(storage.values.get('acttub.firstUse.graduated.u9'), '1');
  setFirstUseOwner(null);
  assert.equal(await hasGraduatedFirstUse(), false);
  setFirstTimeState('unknown');
});
