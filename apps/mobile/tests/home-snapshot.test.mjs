import assert from 'node:assert/strict';
import test from 'node:test';

import { HOME_SNAPSHOT_MAX_AGE_MS, readHomeSnapshot, usableSnapshot, writeHomeSnapshot } from '../lib/home-snapshot.ts';

const memory = () => {
  const m = new Map();
  return { getItem: async (k) => m.get(k) ?? null, setItem: async (k, v) => void m.set(k, v) };
};
const base = { owner: 'u1', groups: [{ id: 'g' }], scripts: [], practices: [], activityDays: [{ created_at: '2026-11-03T00:00:00Z' }], enteredChallengeIds: ['c1'] };

test('남긴 홈은 같은 계정이 7일 안에 열 때만 다시 쓴다', async () => {
  const store = memory();
  const now = Date.parse('2026-11-03T05:00:00Z');
  await writeHomeSnapshot(base, store, now);
  assert.deepEqual((await readHomeSnapshot('u1', store, now + 1000))?.enteredChallengeIds, ['c1']);
  // 다른 계정은 남의 홈을 보지 않는다.
  assert.equal(await readHomeSnapshot('u2', store, now), null);
  // 오래된 홈은 버린다.
  assert.equal(await readHomeSnapshot('u1', store, now + HOME_SNAPSHOT_MAX_AGE_MS + 1), null);
});

test('모양이 깨졌거나 저장소가 없으면 없는 것으로 본다', async () => {
  assert.equal(usableSnapshot({ ...base, savedAt: 1, groups: 'x' }, 'u1', 2), null);
  assert.equal(usableSnapshot(null, 'u1', 2), null);
  assert.equal(await readHomeSnapshot('u1', null), null);
  const broken = { getItem: async () => '{not json', setItem: async () => undefined };
  assert.equal(await readHomeSnapshot('u1', broken), null);
});
