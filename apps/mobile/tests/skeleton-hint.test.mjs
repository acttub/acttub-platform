import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { memoryStorage } from './helpers/stub-modules.mjs';

const storage = memoryStorage();
globalThis.require = () => ({ default: storage });

const { SKELETON_HINT_KEY, getSkeletonHints, loadSkeletonHints, rememberSkeletonHints, resetSkeletonHints } = await import(
  '../lib/skeleton-hint.ts'
);
const { getFirstTimeTabBarHidden, setFirstTimeProvisional, setFirstTimeState } = await import('../lib/practice/first-time.ts');

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

test('적어 둔 것이 없으면 비어 있다 — 화면은 첫 사용자 모양 뼈대를 그린다', async () => {
  await loadSkeletonHints(storage);
  assert.deepEqual(getSkeletonHints(), {});
});

test('실제로 그린 모양을 기기에 적고, 다음에 켤 때 다시 읽는다', async () => {
  rememberSkeletonHints({ home: 'returning', homeCardHeight: 167 }, storage);
  rememberSkeletonHints({ reading: 'list', readingRows: 3 }, storage);
  await new Promise((resolve) => setTimeout(resolve, 0)); // 저장은 화면을 막지 않도록 비동기로 쓴다.
  assert.deepEqual(JSON.parse(await storage.getItem(SKELETON_HINT_KEY)), {
    home: 'returning',
    homeCardHeight: 167,
    reading: 'list',
    readingRows: 3,
  });
  // 앱을 다시 켠 것처럼 메모리만 비우고 저장소에서 읽는다.
  resetSkeletonHints();
  assert.deepEqual(getSkeletonHints(), {});
  await loadSkeletonHints(storage);
  assert.equal(getSkeletonHints().home, 'returning');
  assert.equal(getSkeletonHints().readingRows, 3);
});

test('이상한 값은 버리고 범위를 넘는 수는 자른다', async () => {
  await storage.setItem(SKELETON_HINT_KEY, JSON.stringify({ home: 'x', reading: 'list', readingRows: 40, homeCardHeight: 5, coachingRows: 9 }));
  resetSkeletonHints();
  await loadSkeletonHints(storage);
  assert.deepEqual(getSkeletonHints(), { reading: 'list', readingRows: 6, homeCardHeight: 80, coachingRows: 2 });
  await storage.setItem(SKELETON_HINT_KEY, 'not json');
  resetSkeletonHints();
  await loadSkeletonHints(storage);
  assert.deepEqual(getSkeletonHints(), {});
});

test('홈이 첫 사용자 뼈대를 그리는 동안만 탭바를 숨기고, 판단(첫 사용자 상태)은 바꾸지 않는다', () => {
  setFirstTimeState('unknown');
  assert.equal(getFirstTimeTabBarHidden(), false);
  setFirstTimeProvisional(true);
  assert.equal(getFirstTimeTabBarHidden(), true);
  // 기록을 받아 기존 사용자로 확인되면 뼈대 표시가 남아 있어도 탭바가 보인다.
  setFirstTimeState('practiced');
  assert.equal(getFirstTimeTabBarHidden(), false);
  setFirstTimeProvisional(false);
  setFirstTimeState('first');
  assert.equal(getFirstTimeTabBarHidden(), true);
  setFirstTimeState('unknown');
});

test('홈·리딩·코칭이 기억한 모양으로 받기 전 화면을 고르고, 로그아웃하면 기억을 지운다', () => {
  const home = read('app/(tabs)/index.tsx');
  // 지난번이 첫 사용자 홈이면 기다리지 않고 실제 첫 사용자 홈을 그리고 로고도 닫는다.
  assert.match(home, /const showFirstHome = loaded \? firstUser : skeletonHints\.home === 'first' && !graduatedNow;/);
  assert.match(home, /if \(loaded \|\| showFirstHome\) markHomeReady\(\);/);
  assert.match(home, /\{!showFirstHome && !loaded \? \(/);
  assert.match(home, /variant=\{skeletonHints\.home === 'returning' \? 'returning' : 'first'\}/);
  assert.match(home, /rememberSkeletonHints\(\{ home: 'returning' \}\)/);
  const reading = read('app/(tabs)/reading.tsx');
  assert.match(reading, /const entryHint = skeletonHints\.reading === 'empty' \|\| \(!skeletonHints\.reading && firstTime\);/);
  assert.match(reading, /const showEntry = empty \|\| \(listPending && entryHint\);/);
  assert.match(reading, /listSkeleton \? <ReadingListSkeleton/);
  assert.doesNotMatch(reading, /SkeletonRows/);
  const coaching = read('app/(tabs)/coaching.tsx');
  assert.match(coaching, /const first = entry \? entry\.kind === 'first' : firstHint;/);
  assert.match(coaching, /skeletonHints\.coaching === 'next' \?/);
  assert.match(coaching, /if \(!entry \|\| entryFailed\) return;/);
  const wipe = read('lib/local-account-wipe.ts');
  assert.match(wipe, /SKELETON_HINT_KEY,\n\];/);
  assert.match(wipe, /resetSkeletonHints\(\);/);
  assert.match(read('app/_layout.tsx'), /void loadSkeletonHints\(\);/);
});
