import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// 네이티브 스플래시는 아이콘 없이 단색만 — 아이콘이 하늘색 위에 잠깐 떴다가 JS 진입 화면으로 바뀌어 어색했다(10/29).
const app = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8'));
const splash = app.expo.plugins.find((p) => Array.isArray(p) && p[0] === 'expo-splash-screen')[1];

test('안드로이드·iOS 네이티브 스플래시는 빈 그림을 쓴다(앱 아이콘을 그리지 않는다)', () => {
  assert.equal(splash.android.image, './assets/images/splash-native-blank.png');
  assert.equal(splash.ios.image, './assets/images/splash-native-blank.png');
  assert.equal(JSON.stringify(splash).includes('splash-icon.png'), false);
});
