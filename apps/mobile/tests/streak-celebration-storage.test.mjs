import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { memoryStorage } from './helpers/m4-stubs.mjs';

// AsyncStorage 만 메모리 저장소로 바꾸고, 마지막으로 본 연속일 읽기·쓰기 규칙은 그대로 돈다.
const storage = memoryStorage();
let broken = false;
globalThis.require = (name) => {
  if (name !== '@react-native-async-storage/async-storage') throw new Error(`unexpected require ${name}`);
  if (broken) {
    return {
      default: {
        getItem: async () => { throw new Error('disk'); },
        setItem: async () => { throw new Error('disk'); },
      },
    };
  }
  return { default: storage };
};

const { readLastSeenStreak, writeLastSeenStreak } = await import('../lib/streak-celebration.ts');
const KEY = 'acttub.streak.lastSeen';

beforeEach(() => {
  broken = false;
  storage.values.clear();
});

test('SOMA-479: 처음이면 마지막으로 본 연속일은 0 이다', async () => {
  assert.equal(await readLastSeenStreak(), 0);
});

test('SOMA-479: 본 연속일을 정수로 저장하고 다음 진입에 그대로 읽는다', async () => {
  await writeLastSeenStreak(4.8);
  assert.equal(storage.values.get(KEY), '4');
  assert.equal(await readLastSeenStreak(), 4);
});

test('SOMA-479: 음수는 0 으로 저장한다', async () => {
  await writeLastSeenStreak(-3);
  assert.equal(storage.values.get(KEY), '0');
});

test('SOMA-479: 저장값이 깨졌거나 음수면 0 으로 본다', async () => {
  storage.values.set(KEY, 'abc');
  assert.equal(await readLastSeenStreak(), 0);
  storage.values.set(KEY, '-2');
  assert.equal(await readLastSeenStreak(), 0);
});

test('SOMA-479: 저장소를 못 읽거나 못 쓰면 0 으로 보고 조용히 넘어간다', async () => {
  broken = true;
  assert.equal(await readLastSeenStreak(), 0);
  await writeLastSeenStreak(5);
  broken = false;
  assert.equal(storage.values.has(KEY), false);
});
