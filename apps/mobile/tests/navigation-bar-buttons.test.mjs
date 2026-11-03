import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { keepDarkNavigationButtons } from '../lib/navigation-bar-buttons.ts';

const appRoot = path.resolve(import.meta.dirname, '..');
const readSource = (relativePath) => readFileSync(path.join(appRoot, relativePath), 'utf8');

/** 안드로이드 내비게이션 바 버튼을 진한 색으로 고정한다 (SOMA-929). */
function fakeAppState() {
  const listeners = [];
  return {
    listeners,
    addEventListener: (_type, listener) => {
      listeners.push(listener);
      return { remove: () => listeners.splice(listeners.indexOf(listener), 1) };
    },
  };
}

test('안드로이드에서는 바로 진한 버튼을 걸고, 앱이 다시 활성화될 때마다 다시 건다', () => {
  const calls = [];
  const appState = fakeAppState();
  const stop = keepDarkNavigationButtons({ platform: 'android', setButtonStyle: (s) => calls.push(s), appState });
  assert.deepEqual(calls, ['dark']);
  appState.listeners[0]('background');
  appState.listeners[0]('active');
  assert.deepEqual(calls, ['dark', 'dark']);
  stop();
  assert.equal(appState.listeners.length, 0);
});

test('iOS에서는 아무것도 하지 않는다', () => {
  const calls = [];
  const appState = fakeAppState();
  keepDarkNavigationButtons({ platform: 'ios', setButtonStyle: (s) => calls.push(s), appState });
  assert.deepEqual(calls, []);
  assert.equal(appState.listeners.length, 0);
});

test('버튼 색 지정이 실패해도 앱 흐름을 막지 않는다', async () => {
  const appState = fakeAppState();
  assert.doesNotThrow(() => keepDarkNavigationButtons({
    platform: 'android',
    setButtonStyle: () => Promise.reject(new Error('no activity')),
    appState,
  }));
  assert.doesNotThrow(() => keepDarkNavigationButtons({
    platform: 'android',
    setButtonStyle: () => { throw new Error('sync'); },
    appState,
  }));
  await new Promise((r) => setImmediate(r));
});

test('루트 레이아웃이 expo-navigation-bar로 진한 버튼을 건다', () => {
  const layout = readSource('app/_layout.tsx');
  assert.match(layout, /from 'expo-navigation-bar'/);
  assert.match(layout, /keepDarkNavigationButtons\(/);
  const pkg = JSON.parse(readSource('package.json'));
  assert.ok(pkg.dependencies['expo-navigation-bar']);
});
