import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { memoryStorage } from './helpers/stub-modules.mjs';

const storage = memoryStorage();
globalThis.require = () => ({ default: storage });

const { SKELETON_HINT_KEY, getSkeletonHints, loadSkeletonHints, rememberSkeletonHints, resetSkeletonHints } = await import(
  '../lib/skeleton-hint.ts'
);

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

test('적어 둔 것이 없으면 비어 있다 — 화면은 첫 사용자 모양 뼈대를 그린다', async () => {
  await loadSkeletonHints(storage);
  assert.deepEqual(getSkeletonHints(), {});
});

test('실제로 그린 모양을 기기에 적고, 다음에 켤 때 다시 읽는다', async () => {
  rememberSkeletonHints({ coaching: 'next', coachingRows: 2 }, storage);
  rememberSkeletonHints({ reading: 'list', readingRows: 3 }, storage);
  await new Promise((resolve) => setTimeout(resolve, 0)); // 저장은 화면을 막지 않도록 비동기로 쓴다.
  assert.deepEqual(JSON.parse(await storage.getItem(SKELETON_HINT_KEY)), {
    coaching: 'next',
    coachingRows: 2,
    reading: 'list',
    readingRows: 3,
  });
  // 앱을 다시 켠 것처럼 메모리만 비우고 저장소에서 읽는다.
  resetSkeletonHints();
  assert.deepEqual(getSkeletonHints(), {});
  await loadSkeletonHints(storage);
  assert.equal(getSkeletonHints().coaching, 'next');
  assert.equal(getSkeletonHints().readingRows, 3);
});

test('이상한 값은 버리고 범위를 넘는 수는 자른다 — 없어진 홈 칸(SOMA-1120)은 읽지 않는다', async () => {
  await storage.setItem(SKELETON_HINT_KEY, JSON.stringify({ home: 'returning', homeAd: true, reading: 'list', readingRows: 40, homeCardHeight: 5, coachingRows: 9 }));
  resetSkeletonHints();
  await loadSkeletonHints(storage);
  assert.deepEqual(getSkeletonHints(), { reading: 'list', readingRows: 6, coachingRows: 2 });
  await storage.setItem(SKELETON_HINT_KEY, 'not json');
  resetSkeletonHints();
  await loadSkeletonHints(storage);
  assert.deepEqual(getSkeletonHints(), {});
});

test('리딩·코칭이 기억한 모양으로 받기 전 화면을 고르고, 로그아웃하면 기억을 지운다', () => {
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
