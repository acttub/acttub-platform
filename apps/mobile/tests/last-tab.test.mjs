import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { DEFAULT_TAB, LAST_TAB_KEY, homeTab, isTabName, rememberLastTab, resetLastTabForTest, resolveLaunchTab } from '../lib/last-tab.ts';

const memory = (seed = {}) => {
  const m = new Map(Object.entries(seed));
  return { map: m, getItem: async (k) => m.get(k) ?? null, setItem: async (k, v) => void m.set(k, v) };
};

beforeEach(() => resetLastTabForTest());

test('처음 여는 기기는 리딩 탭을 열고 되살린 것이 아니다', async () => {
  assert.equal(DEFAULT_TAB, 'reading');
  assert.deepEqual(await resolveLaunchTab(memory()), { tab: 'reading', restored: false });
  assert.equal(homeTab(), 'reading');
});

test('마지막에 본 탭을 기기에 남기고, 다시 열면 그 탭을 되살린다', async () => {
  const store = memory();
  await rememberLastTab('community', store);
  assert.equal(store.map.get(LAST_TAB_KEY), 'community');
  assert.equal(homeTab(), 'community');

  // 앱을 다시 켠 것처럼 이번 실행의 기억을 지운다.
  resetLastTabForTest();
  assert.deepEqual(await resolveLaunchTab(store), { tab: 'community', restored: true });
});

test('저장값이 탭 이름이 아니거나 저장소를 못 읽으면 리딩으로 연다', async () => {
  assert.deepEqual(await resolveLaunchTab(memory({ [LAST_TAB_KEY]: 'index' })), { tab: 'reading', restored: false });
  const broken = { getItem: async () => { throw new Error('x'); }, setItem: async () => { throw new Error('x'); } };
  assert.deepEqual(await resolveLaunchTab(broken), { tab: 'reading', restored: false });
  // 못 써도 이번 실행의 「홈으로」는 그 탭이다.
  await rememberLastTab('profile', broken);
  assert.equal(homeTab(), 'profile');
});

test('탭 이름은 하단 바의 다섯 탭뿐이다', () => {
  for (const tab of ['reading', 'coaching', 'community', 'challenges', 'profile']) assert.equal(isTabName(tab), true);
  for (const other of ['index', 'history', 'record', '', null]) assert.equal(isTabName(other), false);
});
