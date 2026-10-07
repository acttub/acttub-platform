import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { BACK_WINDOW_MS, SAME_TARGET_WINDOW_MS, installNavigationGuard } from '../lib/navigation-guard.ts';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

function fakeRouter() {
  const calls = [];
  const router = {
    push: (href, options) => calls.push(['push', href, options]),
    navigate: (href) => calls.push(['navigate', href]),
    replace: (href) => calls.push(['replace', href]),
    back: () => calls.push(['back']),
    dismiss: () => calls.push(['dismiss']),
  };
  return { router, calls };
}

function guarded() {
  let now = 1_000;
  const { router, calls } = fakeRouter();
  installNavigationGuard(router, () => now);
  return { router, calls, tick: (ms) => (now += ms) };
}

test('같은 화면으로 가는 push 를 연달아 누르면 한 번만 간다', () => {
  const { router, calls, tick } = guarded();
  router.push('/coach');
  tick(50);
  router.push('/coach');
  tick(200);
  router.push('/coach');
  assert.deepEqual(calls.map((c) => c[0]), ['push']);
});

test('객체 href 도 pathname·params 가 같으면 같은 화면으로 본다', () => {
  const { router, calls, tick } = guarded();
  router.push({ pathname: '/reading/range', params: { start: '1' } });
  tick(30);
  router.push({ pathname: '/reading/range', params: { start: '1' } });
  tick(30);
  router.push({ pathname: '/reading/range', params: { start: '2' } });
  assert.equal(calls.length, 2);
});

test('창이 지나면 같은 화면으로 다시 갈 수 있다', () => {
  const { router, calls, tick } = guarded();
  router.push('/coach');
  tick(SAME_TARGET_WINDOW_MS + 1);
  router.push('/coach');
  assert.equal(calls.length, 2);
});

test('다른 화면으로 이어 가는 호출은 막지 않는다', () => {
  const { router, calls } = guarded();
  router.push('/analyzing');
  router.replace('/report');
  router.navigate('/(tabs)');
  assert.deepEqual(calls.map((c) => c[0]), ['push', 'replace', 'navigate']);
});

test('push 와 replace 는 같은 화면이어도 따로 센다', () => {
  const { router, calls } = guarded();
  router.push('/reading/play');
  router.replace('/reading/play');
  assert.equal(calls.length, 2);
});

test('뒤로 가기를 연달아 누르면 한 화면만 닫힌다', () => {
  const { router, calls, tick } = guarded();
  router.back();
  tick(100);
  router.back();
  tick(BACK_WINDOW_MS + 1);
  router.back();
  assert.deepEqual(calls.map((c) => c[0]), ['back', 'back']);
});

test('인자는 그대로 넘기고 감싸지 않은 메서드는 건드리지 않는다', () => {
  const { router, calls } = guarded();
  const options = { withAnchor: true };
  router.push('/coach', options);
  router.dismiss();
  router.dismiss();
  assert.deepEqual(calls, [['push', '/coach', options], ['dismiss'], ['dismiss']]);
});

test('두 번 설치해도 한 번만 감싼다', () => {
  let now = 0;
  const { router, calls } = fakeRouter();
  installNavigationGuard(router, () => now);
  installNavigationGuard(router, () => now);
  router.push('/coach');
  now += SAME_TARGET_WINDOW_MS + 1;
  router.push('/coach');
  assert.equal(calls.length, 2);
});

test('루트 레이아웃이 expo-router 의 router 에 가드를 건다', () => {
  const layout = read('../app/_layout.tsx');
  assert.match(layout, /installNavigationGuard\(router\)/);
  assert.match(layout, /import \{[^}]*\brouter\b[^}]*\} from 'expo-router'/s);
});
