import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { memoryStorage, stubModules } from './helpers/stub-modules.mjs';

const storage = memoryStorage();
let broken = false;
globalThis.require = () => {
  if (broken) throw new Error('native module missing');
  return { default: storage };
};
stubModules({});
const guide = await import('../lib/guide-state.ts');
const { setFirstUseOwner } = await import('../lib/practice/first-use-graduation.ts');

beforeEach(() => {
  storage.values.clear();
  broken = false;
  setFirstUseOwner(null);
});

test('화면마다 비춘 안내를 따로 기억한다', async () => {
  setFirstUseOwner('u1');
  assert.equal(await guide.hasSeenSpotlight('home', 0), false);
  await guide.markSpotlightSeen('home');
  assert.equal(await guide.hasSeenSpotlight('home', 0), true);
  assert.equal(await guide.hasSeenSpotlight('reading', 0), false);
  assert.equal(storage.values.get('acttub.spotlight.home.seen.u1'), '1');
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
  assert.equal(await guide.hasSeenSpotlight('group', 0), true);
  assert.equal(await guide.hasSeenTutorial(), true);
  await guide.markTutorialSeen();
  await guide.resetSpotlights();
  broken = false;
  assert.equal(await guide.hasSeenTutorial(), false);
});

test('로그인한 계정마다 따로 기억한다 — 같은 폰의 다른 계정은 홈 안내를 다시 본다(10/25)', async () => {
  setFirstUseOwner('u1');
  await guide.markSpotlightSeen('home');
  assert.equal(await guide.hasSeenSpotlight('home', 0), true);
  setFirstUseOwner('u2');
  assert.equal(await guide.hasSeenSpotlight('home', 0), false);
});

test('예전 기기 공용 기록은 이어받지 않는다 — 계정마다 처음엔 한 번 본다', async () => {
  storage.values.set('acttub.spotlight.home.seen', '1');
  setFirstUseOwner('u1');
  assert.equal(await guide.hasSeenSpotlight('home', 0), false);
  setFirstUseOwner(null);
  assert.equal(await guide.hasSeenSpotlight('home', 0), true);
});

test('가이드 다시 보기는 지금 계정의 기록도 지운다', async () => {
  setFirstUseOwner('u1');
  await guide.markSpotlightSeen('home');
  await guide.resetSpotlights();
  assert.equal(await guide.hasSeenSpotlight('home', 0), false);
});

test('앱을 막 켜 계정을 아직 모를 때 물으면, 계정이 정해질 때까지 기다렸다 그 계정 기록을 읽는다(10/26 폰: 홈 안내가 켤 때마다 다시 뜸)', async () => {
  setFirstUseOwner('u1');
  await guide.markSpotlightSeen('home');
  setFirstUseOwner(null); // 콜드 스타트 — 로그인 정보(me)를 아직 못 받았다
  const asked = guide.hasSeenSpotlight('home');
  setTimeout(() => setFirstUseOwner('u1'), 20);
  assert.equal(await asked, true);
});

test('기다려도 계정이 안 정해지면 본 것으로 친다 — 계정 없는 키를 읽으면 본 사람에게도 다시 떴다(1.0.1 운영)', async () => {
  assert.equal(await guide.hasSeenSpotlight('home', 10), true);
  setFirstUseOwner('u1');
  assert.equal(await guide.hasSeenSpotlight('home', 10), false);
});
