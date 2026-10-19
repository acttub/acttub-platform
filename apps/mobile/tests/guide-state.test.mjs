import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { memoryStorage, stubModules } from './helpers/m4-stubs.mjs';

const storage = memoryStorage();
let broken = false;
globalThis.require = () => {
  if (broken) throw new Error('native module missing');
  return { default: storage };
};
stubModules({});
const guide = await import('../lib/guide-state.ts');

beforeEach(() => {
  storage.values.clear();
  broken = false;
});

test('화면마다 비춘 안내를 따로 기억한다', async () => {
  assert.equal(await guide.hasSeenSpotlight('home'), false);
  await guide.markSpotlightSeen('home');
  assert.equal(await guide.hasSeenSpotlight('home'), true);
  assert.equal(await guide.hasSeenSpotlight('reading'), false);
  assert.equal(storage.values.get('acttub.spotlight.home.seen'), '1');
});

test('연습 튜토리얼과 리딩 튜토리얼을 따로 센다', async () => {
  await guide.markTutorialSeen();
  assert.equal(await guide.hasSeenTutorial(), true);
  assert.equal(await guide.hasSeenReadingTutorial(), false);
  await guide.markReadingTutorialSeen();
  assert.equal(await guide.hasSeenReadingTutorial(), true);
});

test('가이드 다시 보기는 비춘 안내·튜토리얼·자동 넘김 안내를 모두 되살린다', async () => {
  for (const key of ['acttub.spotlight.home.seen', 'acttub.spotlight.reading.seen', 'acttub.spotlight.group.seen',
    'acttub.tutorial.seen', 'acttub.tutorial.reading.seen', 'acttub.reading.autoAdvanceTipHidden', 'acttub.other']) {
    storage.values.set(key, '1');
  }
  await guide.resetSpotlights();
  assert.deepEqual([...storage.values.keys()], ['acttub.other']);
});

test('저장소를 못 쓰면 본 것으로 치고, 적기·지우기는 조용히 넘어간다', async () => {
  broken = true;
  assert.equal(await guide.hasSeenSpotlight('group'), true);
  assert.equal(await guide.hasSeenTutorial(), true);
  await guide.markTutorialSeen();
  await guide.resetSpotlights();
  broken = false;
  assert.equal(await guide.hasSeenTutorial(), false);
});
