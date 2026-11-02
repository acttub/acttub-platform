import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { aheadWindow, CLOUD_AHEAD_LINES } from '../lib/reading/tts/ahead-window.ts';

/** 고품질 목소리는 지금 줄부터 몇 줄만 미리 만든다 (SOMA-1000). */

const lines = Array.from({ length: 40 }, (_, i) => `줄${i + 1}`);

test('고품질 목소리는 지금 줄부터 5줄만 미리 만든다', () => {
  assert.equal(CLOUD_AHEAD_LINES, 5);
  assert.deepEqual(aheadWindow(lines, true), ['줄1', '줄2', '줄3', '줄4', '줄5']);
  assert.deepEqual(aheadWindow(lines.slice(0, 3), true), ['줄1', '줄2', '줄3']);
  assert.deepEqual(aheadWindow([], true), []);
});

test('폰 안의 앱 목소리는 지금처럼 남은 줄을 모두 미리 만든다', () => {
  assert.equal(aheadWindow(lines, false).length, 40);
});

test('재생 화면은 상대 대사를 창으로 자른 뒤 목소리 조각으로 나눈다', () => {
  const play = readFileSync(new URL('../app/reading/play.tsx', import.meta.url), 'utf8');
  const prime = play.slice(play.indexOf('const primeSpeech = useCallback'), play.indexOf('const flash = useCallback'));
  assert.match(prime, /aheadWindow\(partners, engineRef\.current === 'cloud'\)/);
  assert.ok(prime.indexOf('aheadWindow(') < prime.indexOf('.flatMap('), '창은 줄 단위로 자른다');
});
