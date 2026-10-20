import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  firstTimeStateFrom,
  getFirstTimeState,
  setFirstTimeState,
  subscribeFirstTimeState,
} from '../lib/practice/first-time.ts';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

test('연습 1회 기준 연습한 날이 하나라도 있으면 연습한 사람이다', () => {
  assert.equal(firstTimeStateFrom({ practicedDays: 1, groupsFailed: false }), 'practiced');
  // 묶음을 못 받아도 연습한 날이 있으면 연습한 사람이 맞다.
  assert.equal(firstTimeStateFrom({ practicedDays: 3, groupsFailed: true }), 'practiced');
});

test('연습한 날이 없으면 첫 사용자다', () => {
  assert.equal(firstTimeStateFrom({ practicedDays: 0, groupsFailed: false }), 'first');
});

test('기록을 아직 못 받았거나 묶음을 못 받았으면 모른다 — 함부로 첫 사용자로 보지 않는다', () => {
  assert.equal(firstTimeStateFrom({ practicedDays: null, groupsFailed: false }), 'unknown');
  assert.equal(firstTimeStateFrom({ practicedDays: 0, groupsFailed: true }), 'unknown');
});

test('첫 사용자 상태는 한 곳에 두고 바뀌면 구독자에게 알린다', () => {
  assert.equal(getFirstTimeState(), 'unknown');
  let calls = 0;
  const off = subscribeFirstTimeState(() => {
    calls += 1;
  });
  setFirstTimeState('first');
  setFirstTimeState('first');
  assert.equal(getFirstTimeState(), 'first');
  assert.equal(calls, 1);
  setFirstTimeState('practiced');
  assert.equal(calls, 2);
  off();
  setFirstTimeState('unknown');
  assert.equal(calls, 2);
});

test('홈이 받은 연습 기록으로 첫 사용자 상태를 정하고, 홈을 떠나도 지우지 않는다', () => {
  const home = read('app/(tabs)/index.tsx');
  assert.match(home, /setFirstTimeState\(firstTimeStateFrom\(\{ practicedDays: activityDays\?\.length \?\? null, groupsFailed \}\)\)/);
  assert.doesNotMatch(home, /setHomeTabBarHidden/);
});

test('탭 레이아웃은 첫 사용자면 모든 탭에서 탭바를 숨긴다', () => {
  const layout = read('app/(tabs)/_layout.tsx');
  assert.match(layout, /tabBarStyle: firstTime \? TAB_BAR_HIDDEN : tabBarStyle/);
});
