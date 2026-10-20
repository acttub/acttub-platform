import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { stubModules } from './helpers/stub-modules.mjs';

const state = { os: 'ios', hasAction: true, calls: [] };
globalThis.__storeReview = state;
stubModules({
  'expo-store-review': `const s = globalThis.__storeReview;
    export const hasAction = async () => { if (s.hasAction instanceof Error) throw s.hasAction; return s.hasAction; };
    export const requestReview = async () => { s.calls.push('inApp'); };`,
  'react-native': `const s = globalThis.__storeReview;
    export const Platform = { get OS() { return s.os; } };
    export const Linking = { openURL: async url => { s.calls.push(url); if (s.openFails) throw new Error('no store'); } };`,
});
const { openStoreReview, openStoreReviewPage } = await import('../lib/store-review.ts');

beforeEach(() => Object.assign(state, { os: 'ios', hasAction: true, calls: [], openFails: false }));

test('인앱 평점 창을 줄 수 있으면 그것만 띄운다', async () => {
  await openStoreReview();
  assert.deepEqual(state.calls, ['inApp']);
});

test('인앱 창을 못 주거나 실패하면 그 플랫폼 스토어의 리뷰 쓰기 화면으로 보낸다', async () => {
  state.hasAction = false;
  await openStoreReview();
  state.os = 'android';
  state.hasAction = new Error('boom');
  await openStoreReview();
  assert.deepEqual(state.calls, [
    'itms-apps://apps.apple.com/app/id6793056855?action=write-review',
    'https://play.google.com/store/apps/details?id=com.acttub.app&showAllReviews=true',
  ]);
});

test('스토어를 열지 못해도 던지지 않는다', async () => {
  state.openFails = true;
  await openStoreReviewPage();
  assert.equal(state.calls.length, 1);
});
