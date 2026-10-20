import assert from 'node:assert/strict';
import { test } from 'node:test';

import { memoryStorage } from './helpers/stub-modules.mjs';

const storage = memoryStorage();
let broken = false;
globalThis.require = () => {
  if (broken) throw new Error('native module missing');
  return { default: storage };
};
const { hasSeenChallengeIntro, markChallengeIntroSeen } = await import('../lib/challenge/intro-state.ts');

test('챌린지 시작 안내는 기기당 한 번만 보여 준다', async () => {
  assert.equal(await hasSeenChallengeIntro(), false);
  await markChallengeIntroSeen();
  assert.equal(await hasSeenChallengeIntro(), true);
  assert.equal(storage.values.get('acttub.challenge.introSeen'), '1');
});

test('저장소를 못 쓰면 본 것으로 치고 적기는 조용히 넘어간다', async () => {
  storage.values.clear();
  broken = true;
  assert.equal(await hasSeenChallengeIntro(), true);
  await markChallengeIntroSeen();
  broken = false;
  assert.equal(await hasSeenChallengeIntro(), false);
});
