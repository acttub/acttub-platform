import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { installGlobalStorage } from './helpers/global-require-storage.mjs';

const state = installGlobalStorage();
const prefs = await import('../lib/reading/listen-prefs.ts');

beforeEach(() => {
  state.items.clear();
  state.broken = false;
});

test('듣기 설정(SOMA-952·954): 남긴 것이 없으면 핸즈프리 꺼짐·보통 속도이고, 고른 값을 다시 읽는다', async () => {
  assert.deepEqual(await prefs.loadListenPrefs(), { handsFree: false, rate: 1 });
  await prefs.saveListenPrefs({ handsFree: true, rate: 1.2 });
  assert.deepEqual(await prefs.loadListenPrefs(), { handsFree: true, rate: 1.2 });
});

test('듣기 설정: 모르는 속도·깨진 값·못 읽는 저장소는 기본값으로 돌아간다', async () => {
  state.items.set(prefs.LISTEN_PREFS_KEY, JSON.stringify({ handsFree: 'yes', rate: 3 }));
  assert.deepEqual(await prefs.loadListenPrefs(), { handsFree: false, rate: 1 });
  state.items.set(prefs.LISTEN_PREFS_KEY, '{');
  assert.deepEqual(await prefs.loadListenPrefs(), { handsFree: false, rate: 1 });
  state.broken = true;
  assert.deepEqual(await prefs.loadListenPrefs(), { handsFree: false, rate: 1 });
  await prefs.saveListenPrefs({ handsFree: true, rate: 1.5 });
});

test('핸즈프리 쉬는 시간: 대사 길이에 맞추고, 지문·문장부호는 세지 않고, 속도를 올리면 짧아지며, 위아래 한도가 있다', () => {
  const short = prefs.pauseMsFor('응.');
  const long = prefs.pauseMsFor('그건 네가 한 말이잖아. 나는 그날 아무 데도 가지 않았어.');
  assert.equal(short, prefs.PAUSE_MIN_MS);
  assert.ok(long > short);
  assert.equal(prefs.pauseMsFor('(웃으며) 안녕'), prefs.pauseMsFor('안녕'));
  assert.equal(prefs.pauseMsFor('안녕하세요 반갑습니다'), prefs.PAUSE_BASE_MS + 10 * prefs.PAUSE_MS_PER_CHAR);
  assert.ok(prefs.pauseMsFor('안녕하세요 반갑습니다', 1.5) < prefs.pauseMsFor('안녕하세요 반갑습니다'));
  assert.equal(prefs.pauseMsFor('가'.repeat(500)), prefs.PAUSE_MAX_MS);
});

test('속도 칸 숫자: 정수는 소수점 없이', () => {
  assert.deepEqual(prefs.READING_RATES.map(prefs.rateLabel), ['0.8', '1', '1.2', '1.5']);
});
