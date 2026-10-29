import assert from 'node:assert/strict';
import { test } from 'node:test';

import { memoryStorage } from './helpers/stub-modules.mjs';

const storage = memoryStorage();
let broken = false;
globalThis.require = () => {
  if (broken) throw new Error('native module missing');
  return { default: storage };
};
const { hasBrowsedChallenges, markChallengesBrowsed } = await import('../lib/challenge/intro-state.ts');

test('「챌린지 둘러보기」를 고른 기기는 기억하고, 저장소를 못 쓰면 안 고른 것으로 친다(SOMA-827)', async () => {
  storage.values.clear();
  assert.equal(await hasBrowsedChallenges(), false);
  await markChallengesBrowsed();
  assert.equal(await hasBrowsedChallenges(), true);
  assert.equal(storage.values.get('acttub.challenge.browsed'), '1');

  storage.values.clear();
  broken = true;
  assert.equal(await hasBrowsedChallenges(), false);
  await markChallengesBrowsed();
  broken = false;
  assert.equal(await hasBrowsedChallenges(), false);
});
