import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { installGlobalStorage } from './helpers/global-require-storage.mjs';

const state = installGlobalStorage();
const prefs = await import('../lib/reading/listen-prefs.ts');

beforeEach(() => {
  state.items.clear();
  state.broken = false;
});

test('듣기 설정(SOMA-952·954): 남긴 것이 없으면 자동 넘김 꺼짐·보통 속도·쉬는 시간 2초이고, 고른 값을 다시 읽는다', async () => {
  assert.deepEqual(await prefs.loadListenPrefs(), { handsFree: false, rate: 1, pauseSec: 2 });
  await prefs.saveListenPrefs({ handsFree: true, rate: 1.2, pauseSec: 3 });
  assert.deepEqual(await prefs.loadListenPrefs(), { handsFree: true, rate: 1.2, pauseSec: 3 });
});

test('듣기 설정: 모르는 속도·깨진 값·못 읽는 저장소는 기본값으로 돌아간다', async () => {
  state.items.set(prefs.LISTEN_PREFS_KEY, JSON.stringify({ handsFree: 'yes', rate: 3, pauseSec: 70 }));
  assert.deepEqual(await prefs.loadListenPrefs(), { handsFree: false, rate: 1, pauseSec: 2 });
  state.items.set(prefs.LISTEN_PREFS_KEY, '{');
  assert.deepEqual(await prefs.loadListenPrefs(), { handsFree: false, rate: 1, pauseSec: 2 });
  state.broken = true;
  assert.deepEqual(await prefs.loadListenPrefs(), { handsFree: false, rate: 1, pauseSec: 2 });
  await prefs.saveListenPrefs({ handsFree: true, rate: 1.5, pauseSec: 2 });
});

test('자동 넘김 쉬는 시간: 적은 글을 초로 읽고(소수 한 자리, 쉼표 허용), 0.5~30초 밖이나 숫자가 아니면 받지 않는다', () => {
  assert.equal(prefs.parsePause('2'), 2);
  assert.equal(prefs.parsePause(' 1.5 '), 1.5);
  assert.equal(prefs.parsePause('2,5'), 2.5);
  assert.equal(prefs.parsePause('1.25'), 1.3);
  assert.equal(prefs.parsePause('0.5'), 0.5);
  assert.equal(prefs.parsePause('30'), 30);
  for (const bad of ['', '0', '0.4', '31', 'abc', '1.2.3', '-1']) assert.equal(prefs.parsePause(bad), null, bad);
  assert.equal(prefs.pauseMsFor(3), 3000);
  assert.equal(prefs.pauseMsFor(1.5), 1500);
  assert.equal(prefs.pauseMsFor(99), 2000);
});

test('속도 칸 숫자: 정수는 소수점 없이', () => {
  assert.deepEqual(prefs.READING_RATES.map(prefs.rateLabel), ['0.8', '1', '1.2', '1.5']);
});
