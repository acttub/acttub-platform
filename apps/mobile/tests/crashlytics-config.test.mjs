import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { crashEnvironment } from '../lib/crashlytics.ts';

const appRoot = path.resolve(import.meta.dirname, '..');
const read = (rel) => readFileSync(path.join(appRoot, rel), 'utf8');

test('crashlytics: 플러그인·iOS dSYM 업로드·디버그 빌드 제외가 설정에 있다', () => {
  const plugins = JSON.parse(read('app.json')).expo.plugins.map((p) => (Array.isArray(p) ? p[0] : p));
  assert.ok(plugins.includes('@react-native-firebase/crashlytics'));
  assert.ok(plugins.includes('./plugins/with-crashlytics-dsym.js'));
  assert.match(read('plugins/with-crashlytics-dsym.js'), /FirebaseCrashlytics\/run/);
  assert.match(read('plugins/with-non-modular-headers.js'), /'RNFBCrashlytics'/);
  const firebase = JSON.parse(read('firebase.json'))['react-native'];
  assert.equal(firebase.crashlytics_debug_enabled, false);
  assert.match(read('app/_layout.tsx'), /initCrashlytics\(\)/);
});

test('crashlytics: 운영 API 빌드만 prod, 나머지는 dev 로 표시한다', () => {
  assert.equal(crashEnvironment('https://acttub.com'), 'prod');
  assert.equal(crashEnvironment('https://dev.acttub.com'), 'dev');
  assert.equal(crashEnvironment(undefined), 'dev');
});

test('crashlytics: 화면이 바뀔 때마다 크래시 기록에 화면 경로를 남긴다 — 메모리 부족처럼 스택만으론 어디서인지 모르는 크래시용', async () => {
  const { readFileSync } = await import('node:fs');
  const path = (await import('node:path')).default;
  const root = path.resolve(import.meta.dirname, '..');
  const lib = readFileSync(path.join(root, 'lib/crashlytics.ts'), 'utf8');
  assert.match(lib, /export function markScreen\(/);
  assert.match(lib, /setAttribute\(crashlytics, 'screen', screen\)/);
  assert.match(lib, /log\(crashlytics, `screen \$\{screen\}`\)/);
  const layout = readFileSync(path.join(root, 'app/_layout.tsx'), 'utf8');
  assert.match(layout, /markScreen\(screen\)/);
});
