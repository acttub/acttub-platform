import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const appRoot = path.resolve(import.meta.dirname, '..');
const read = (rel) => readFileSync(path.join(appRoot, rel), 'utf8');

// SOMA-1091: 운영 빌드에는 window.location 이 없어 expo-router 기본 사이트맵(SystemInfo)이 열리는 순간 앱이 꺼졌다.
test('router: expo-router 기본 사이트맵을 끈다 — 운영 빌드에서 열리면 window.location.origin 에서 꺼진다', () => {
  const plugins = JSON.parse(read('app.json')).expo.plugins;
  const router = plugins.find((p) => (Array.isArray(p) ? p[0] : p) === 'expo-router');
  assert.ok(Array.isArray(router), 'expo-router 플러그인에 옵션이 있어야 한다');
  assert.equal(router[1].sitemap, false);
});

test('router: 없는 주소는 우리 레이아웃 안의 +not-found 가 받는다 — 기본 영어 Unmatched 화면은 레이아웃 밖이라 크래시 기록이 비었다', () => {
  assert.ok(existsSync(path.join(appRoot, 'app/+not-found.tsx')));
  assert.match(read('app/+native-intent.tsx'), /markEntryPath\(path, initial\)/);
});
