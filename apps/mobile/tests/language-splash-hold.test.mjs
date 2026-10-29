import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { LANGUAGE_SPLASH_MIN_MS } from '../lib/launch-splash.ts';

// 언어를 바꾸면 화면을 새로 그리며 진입 화면이 다시 뜨는데, 이미 준비가 끝나 있어 깜빡이고 사라졌다 — 최소 1.5초 둔다(10/29).
const layout = readFileSync(new URL('../app/_layout.tsx', import.meta.url), 'utf8');

test('언어를 바꿔 다시 그릴 때만 진입 화면을 최소 1.5초 둔다', () => {
  assert.equal(LANGUAGE_SPLASH_MIN_MS, 1500);
  assert.match(layout, /<RootNavigator key=\{languageKey\} minSplashMs=\{languageKey > 0 \? LANGUAGE_SPLASH_MIN_MS : 0\} \/>/);
  assert.match(layout, /if \(readyToShow && !holdSplashForHome && minSplashElapsed\) setLaunchDone\(true\);/);
});
