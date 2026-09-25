import assert from 'node:assert/strict';
import test from 'node:test';

import { cellCaption, deleteDecision, mergeLibrary, posterFor, statusLabel, usageLabel } from '../lib/library/library-view.ts';

const NOW = Date.parse('2026-09-21T12:00:00+09:00');
const DAY = 86_400_000;
const video = (id, o = {}) => ({
  id,
  duration_ms: 42_000,
  byte_size: 1_000,
  content_type: 'video/mp4',
  favorite: false,
  purged_at: null,
  created_at: new Date(NOW - DAY).toISOString(),
  usage: { practice_count: 0, entry_count: 0 },
  playback_url: null,
  playback_expires_at: null,
  poster_url: null,
  ...o,
});
const pending = (id, o = {}) => ({ id, owner: 'u1', requestId: `rid-${id}`, uri: `file:///a/${id}.mp4`, contentType: 'video/mp4', durationMs: 5_000, createdAt: NOW - 60_000, intentId: null, intentExpiresAt: null, status: 'queued', lastError: null, ...o });

test('practice.library: 보관함은 내 영상을 최신 저장순으로 보여 주고 예시 영상을 섞지 않는다(비어 있으면 빈 목록)', () => {
  const items = mergeLibrary({ videos: [video('v1', { created_at: new Date(NOW - 3 * DAY).toISOString() }), video('v2')], pending: [], filter: 'all', now: NOW });
  assert.deepEqual(items.map((i) => i.id), ['v2', 'v1']);
  assert.deepEqual(mergeLibrary({ videos: [], pending: [], filter: 'all', now: NOW }), []);
});

test('practice.record: 마무리 전 영상은 "기기에 저장 · 업로드 대기"로 맨 위에, 확정된 영상은 "보관함 저장"으로 보인다', () => {
  const items = mergeLibrary({ videos: [video('v1')], pending: [pending('p1')], filter: 'all', now: NOW });
  assert.deepEqual(items.map((i) => i.kind), ['pending', 'video']);
  assert.equal(statusLabel(items[0]), '기기에 저장 · 업로드 대기');
  assert.equal(statusLabel(items[1]), '보관함 저장');
  assert.equal(statusLabel(mergeLibrary({ videos: [], pending: [pending('p2', { status: 'failed', lastError: 'video_quota' })], filter: 'all', now: NOW })[0]), '업로드 실패 · 다시 시도');
  assert.equal(statusLabel(mergeLibrary({ videos: [video('v9', { purged_at: '2026-09-20T00:00:00Z' })], pending: [], filter: 'all', now: NOW })[0]), '재생할 수 없어요');
});

test('practice.library: 최근 7일 필터는 7일 안의 것만, 즐겨찾기 필터는 videos.favorite 인 것만 보여 준다', () => {
  const videos = [video('old', { created_at: new Date(NOW - 8 * DAY).toISOString() }), video('new'), video('fav', { favorite: true, created_at: new Date(NOW - 9 * DAY).toISOString() })];
  assert.deepEqual(mergeLibrary({ videos, pending: [pending('p1')], filter: 'recent7', now: NOW }).map((i) => i.id), ['p1', 'new']);
  assert.deepEqual(mergeLibrary({ videos, pending: [pending('p1')], filter: 'favorite', now: NOW }).map((i) => i.id), ['fav']);
});

test('practice.library: 사용처는 "회차 n개 · 챌린지 참여작 n개"이고 참조가 있으면 삭제 대신 사용처와 "파일만 파기"를 안내한다', () => {
  assert.equal(usageLabel({ practice_count: 2, entry_count: 1 }), '회차 2개 · 챌린지 참여작 1개');
  assert.equal(usageLabel({ practice_count: 0, entry_count: 0 }), '아직 쓰인 곳이 없어요');
  assert.deepEqual(deleteDecision(video('v1')), { kind: 'delete' });
  assert.deepEqual(deleteDecision(video('v2', { usage: { practice_count: 2, entry_count: 0 } })), { kind: 'in_use', usage: '회차 2개 · 챌린지 참여작 0개', canPurge: true });
  assert.deepEqual(deleteDecision(video('v3', { usage: { practice_count: 2, entry_count: 0 }, purged_at: '2026-09-20T00:00:00Z' })), { kind: 'in_use', usage: '회차 2개 · 챌린지 참여작 0개', canPurge: false });
});

test('practice.library: 보관함 칸은 저장된 영상이면 어디에 쓰였는지를, 아니면 상태를 짧게 보여 준다 (SOMA-494)', () => {
  const one = (o) => mergeLibrary({ videos: [video('v', o)], pending: [], filter: 'all', now: NOW })[0];
  assert.equal(cellCaption(one({ usage: { practice_count: 2, entry_count: 1 } })), '연습 2회 · 챌린지 1개');
  assert.equal(cellCaption(one({ usage: { practice_count: 3, entry_count: 0 } })), '연습 3회');
  assert.equal(cellCaption(one({ usage: { practice_count: 0, entry_count: 1 } })), '챌린지 1개');
  assert.equal(cellCaption(one({})), '아직 안 쓴 영상');
  assert.equal(cellCaption(one({ purged_at: '2026-09-20T00:00:00Z', usage: { practice_count: 1, entry_count: 0 } })), '재생할 수 없어요');
  const queued = mergeLibrary({ videos: [], pending: [pending('p1')], filter: 'all', now: NOW })[0];
  assert.equal(cellCaption(queued), '기기에 저장 · 업로드 대기');
});

test('practice.library: 보관함 칸은 서버 포스터가 있으면 첫 장면 사진을 쓰고, 서명이 바뀌어도 같은 캐시 키다 (SOMA-562)', () => {
  const one = (o) => mergeLibrary({ videos: [video('v', o)], pending: [], filter: 'all', now: NOW })[0];
  assert.deepEqual(posterFor(one({ poster_url: 'https://s3.example/videos/u/r.poster.jpg?X-Amz-Signature=a' })), {
    uri: 'https://s3.example/videos/u/r.poster.jpg?X-Amz-Signature=a',
    cacheKey: 'https://s3.example/videos/u/r.poster.jpg',
  });
  assert.equal(posterFor(one({ poster_url: null })), null);
  // 파기된 영상은 포스터가 남아 있어도 보이지 않는다.
  assert.equal(posterFor(one({ poster_url: 'https://s3.example/p.jpg', purged_at: '2026-09-20T00:00:00Z' })), null);
  assert.equal(posterFor(mergeLibrary({ videos: [], pending: [pending('p1')], filter: 'all', now: NOW })[0]), null);
});
