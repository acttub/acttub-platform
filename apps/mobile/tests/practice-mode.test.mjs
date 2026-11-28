import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import {
  DEFAULT_PRACTICE_MODE,
  PRACTICE_MODE_KEY,
  isPracticeMode,
  knownPracticeMode,
  practiceHref,
  rememberPracticeMode,
  resetPracticeModeForTest,
  resolvePracticeMode,
} from '../lib/practice-mode.ts';

const memory = (seed = {}) => {
  const m = new Map(Object.entries(seed));
  return { map: m, getItem: async (k) => m.get(k) ?? null, setItem: async (k, v) => void m.set(k, v) };
};

beforeEach(() => resetPracticeModeForTest());

test('처음 여는 기기는 리딩을 연다', async () => {
  assert.equal(DEFAULT_PRACTICE_MODE, 'reading');
  assert.equal(knownPracticeMode(), null);
  assert.equal(await resolvePracticeMode(memory()), 'reading');
});

test('고른 쪽을 기기에 남기고, 다시 열면 그쪽을 연다', async () => {
  const store = memory();
  await rememberPracticeMode('coaching', store);
  assert.equal(store.map.get(PRACTICE_MODE_KEY), 'coaching');
  assert.equal(knownPracticeMode(), 'coaching');

  resetPracticeModeForTest();
  assert.equal(await resolvePracticeMode(store), 'coaching');
  assert.equal(knownPracticeMode(), 'coaching');
});

test('같은 쪽이면 다시 쓰지 않는다', async () => {
  let writes = 0;
  const store = { getItem: async () => null, setItem: async () => void (writes += 1) };
  await rememberPracticeMode('coaching', store);
  await rememberPracticeMode('coaching', store);
  assert.equal(writes, 1);
});

test('저장값이 리딩·코칭이 아니거나 저장소를 못 읽고 쓰면 리딩으로 연다', async () => {
  assert.equal(await resolvePracticeMode(memory({ [PRACTICE_MODE_KEY]: 'home' })), 'reading');
  const broken = { getItem: async () => Promise.reject(new Error('x')), setItem: async () => Promise.reject(new Error('x')) };
  assert.equal(await resolvePracticeMode(broken), 'reading');
  await rememberPracticeMode('coaching', broken);
  assert.equal(knownPracticeMode(), 'coaching');
  assert.equal(await resolvePracticeMode(null), 'coaching');
});

test('모드 판별과 연습 탭 주소', () => {
  assert.equal(isPracticeMode('reading'), true);
  assert.equal(isPracticeMode('coaching'), true);
  assert.equal(isPracticeMode('practice'), false);
  assert.equal(isPracticeMode(undefined), false);
  assert.equal(practiceHref('reading'), '/practice?mode=reading');
  assert.equal(practiceHref('coaching'), '/practice?mode=coaching');
});
