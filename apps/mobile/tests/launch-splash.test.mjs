import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import {
  HOME_SPLASH_HOLD_MS,
  isHomeReady,
  markHomeReady,
  resetHomeReadyForTest,
  shouldHoldSplashForHome,
  subscribeHomeReady,
} from '../lib/launch-splash.ts';

const base = { signedInHome: true, pathname: '/', homeReady: false, holdExpired: false };

test('홈으로 들어가는 길이고 홈이 아직 준비 전이면 로고를 붙잡는다', () => {
  assert.equal(shouldHoldSplashForHome(base), true);
});

test('홈이 준비됐거나 상한이 지나면 로고를 닫는다', () => {
  assert.equal(shouldHoldSplashForHome({ ...base, homeReady: true }), false);
  assert.equal(shouldHoldSplashForHome({ ...base, holdExpired: true }), false);
  assert.equal(HOME_SPLASH_HOLD_MS, 3000);
});

test('로그인·동의·프로필·분석 화면으로 가는 길에서는 기다리지 않는다', () => {
  assert.equal(shouldHoldSplashForHome({ ...base, signedInHome: false }), false);
  assert.equal(shouldHoldSplashForHome({ ...base, pathname: '/analyzing' }), false);
  assert.equal(shouldHoldSplashForHome({ ...base, pathname: '/login' }), false);
});

test('홈 준비 신호는 한 번만 알린다', () => {
  resetHomeReadyForTest();
  let calls = 0;
  const off = subscribeHomeReady(() => calls++);
  assert.equal(isHomeReady(), false);
  markHomeReady();
  markHomeReady();
  assert.equal(isHomeReady(), true);
  assert.equal(calls, 1);
  off();
});

test('홈은 로딩 표시 없이 첫 데이터를 받으면 준비 신호를 보낸다', () => {
  const home = readFileSync(new URL('../app/(tabs)/index.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(home, /ActivityIndicator/);
  assert.match(home, /if \(loaded\) markHomeReady\(\)/);
  const layout = readFileSync(new URL('../app/_layout.tsx', import.meta.url), 'utf8');
  assert.match(layout, /readyToShow && !holdSplashForHome/);
});
