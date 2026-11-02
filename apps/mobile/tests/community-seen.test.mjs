import assert from 'node:assert/strict';
import test from 'node:test';

import { installGlobalStorage } from './helpers/global-require-storage.mjs';

// 「게시판」 빨간 점(SOMA-873) — 마지막으로 본 최신 글 시각을 기기에 적는다.
const state = installGlobalStorage();
const { boardSeenAt, markBoardSeen } = await import('../lib/community-seen.ts');

test('처음엔 본 시각이 없고, 본 최신 글 시각을 적는다', async () => {
  state.items.clear();
  assert.equal(await boardSeenAt(), null);
  await markBoardSeen('2026-11-02T01:00:00Z');
  assert.equal(await boardSeenAt(), '2026-11-02T01:00:00Z');
});

test('더 이른 시각으로 되돌리지 않는다', async () => {
  state.items.clear();
  await markBoardSeen('2026-11-02T02:00:00Z');
  await markBoardSeen('2026-11-02T01:00:00Z');
  assert.equal(await boardSeenAt(), '2026-11-02T02:00:00Z');
});

test('저장소가 망가져도 던지지 않는다', async () => {
  state.broken = true;
  assert.equal(await boardSeenAt(), null);
  await markBoardSeen('2026-11-02T03:00:00Z');
  state.broken = false;
});
