import assert from 'node:assert/strict';
import test from 'node:test';
import { api, httpResponses, id } from './helpers/practice-api.mjs';

// 챌린지 API 호출 전부를 실제 api.ts 로 부르고, 경로·메서드·요청 본문은 서버 OpenAPI 에, 가짜 응답은 서버 응답 스키마에
// 맞는지 본다(추가 칸이 있으면 실패한다). 서버가 실제로 내는 모양 그대로의 응답으로 앱 타입이 읽히는지를 함께 확인한다.

const card = (over = {}) => ({
  id: id(1), line: '가지 마.', work: '창작', character: null, scene_note: null, origin: 'team', host_name: null,
  is_host: false, starts_at: '2026-09-22T03:00:00Z', ends_at: '2026-09-29T03:00:00Z', featured_on: '2026-09-23',
  moderation: 'visible', entry_count: 2, like_sum: 5, participants: [{ user_id: id(7), name: '니나', founding_number: null }], more_count: 1,
  ranking_state: null, ...over,
});
const entry = (over = {}) => ({
  id: id(2), challenge_id: id(1), author: { user_id: id(7), name: '니나', founding_number: null }, caption: null, like_count: 5,
  comment_count: 1, view_count: 3, rank: 1, final_like_count: null, published_at: '2026-09-23T03:00:00Z',
  playback_url: 'https://storage.test/v.mp4', original_playback_url: null, liked: false, saved: false, is_mine: false, is_new: false, ...over,
});
const mine = (over = {}) => {
  const { is_new: _unused, ...base } = entry({ is_mine: true, author: { user_id: id(8), name: '나', founding_number: null } });
  return { ...base, content_version: 1, visibility: 'public',
  status: 'visible', category: 'public', challenge_hidden: false,
  challenge: { id: id(1), line: '가지 마.', work: '창작', character: null, ends_at: '2026-09-29T03:00:00Z' },
  created_at: '2026-09-23T03:00:00Z', face_mosaic: false, mosaic_status: null, poster_url: null, ...over };
};
const comment = (over = {}) => ({
  id: id(4), author: { user_id: id(7), name: '니나', founding_number: null }, body: '좋아요', created_at: '2026-09-23T03:00:00Z',
  is_mine: false, author_withdrawn: false, status: 'visible', ...over,
});
const group = (over = {}) => ({
  group_key: `${id(8)}|entry_liked|${id(2)}|1790132400`, kind: 'entry_liked', actor_count: 3, event_count: 3,
  actor_name: '니나', challenge_id: id(1), entry_id: id(2), comment_id: null, comment_excerpt: null,
  latest_at: '2026-09-23T03:00:00Z', read: false, target_available: true, ...over,
});

test('챌린지 목록·상세·개설·삭제는 서버 계약 그대로 오간다', async t => {
  const calls = httpResponses(t, [
    { body: { featured: card(), challenges: [card({ id: id(9), featured_on: null })], next_cursor: null } },
    { body: card({ ranking_state: 'final' }) },
    { status: 201, body: card({ origin: 'member', host_name: '나', is_host: true, featured_on: null }) },
    { status: 204 },
  ]);
  const list = await api.listChallenges({ tab: 'popular', q: '니나' });
  assert.equal(list.featured?.participants[0].name, '니나');
  assert.equal((await api.getChallenge(id(1))).ranking_state, 'final');
  await api.createChallenge({ request_id: id(20), line: '가지 마.', work: '창작', duration_days: 7 });
  await api.deleteChallenge(id(1));
  assert.equal(calls[0].url.includes('q=%EB%8B%88%EB%82%98'), true);
});

test('참여작 목록·참여·수정·삭제·조회수는 서버 경로와 본문을 쓴다', async t => {
  const calls = httpResponses(t, [
    { body: { entries: [entry()], next_cursor: 'c1', ranking_state: null } },
    { status: 201, body: mine() },
    { body: mine({ caption: '새 캡션', content_version: 2, visibility: 'private', category: 'private' }) },
    { status: 204 },
    { status: 204 },
    { body: { ...entry(), challenge_id: id(1) } },
    { body: { counts: { all: 1, public: 1, private: 0, under_review: 0 }, entries: [mine()], next_cursor: null } },
  ]);
  const page = await api.listChallengeEntries(id(1), { sort: 'likes', fromEntry: id(2) });
  assert.equal(page.entries[0].rank, 1);
  await api.createEntry(id(1), { request_id: id(21), video_id: id(3), visibility: 'public' });
  await api.updateEntry(id(2), { caption: '새 캡션', visibility: 'private' });
  await api.deleteEntry(id(2));
  await api.recordEntryView(id(2), id(22));
  assert.equal((await api.getEntry(id(2))).challenge_id, id(1));
  assert.equal((await api.listMyChallengeEntries('public')).counts.all, 1);
  assert.match(calls[0].url, /from_entry=/);
  assert.equal(calls[1].headers.get('X-Request-Id'), id(21));
});

test('좋아요·저장·댓글·신고·차단은 서버 경로와 응답 모양을 쓴다', async t => {
  const calls = httpResponses(t, [
    { body: { like_count: 6, liked: true } },
    { body: { like_count: 5, liked: false } },
    { body: { saved: true } },
    { body: { entries: [entry({ saved: true })], my_entry_count: 1, saved_count: 1, next_cursor: null } },
    { body: { comments: [comment(), comment({ id: id(5), is_mine: true, status: 'hidden' })], next_cursor: null } },
    { status: 201, body: comment({ is_mine: true }) },
    { status: 204 },
    { status: 201, body: { id: id(6), status: 'received' } },
    { body: { user_id: id(7), blocked: true } },
    { body: { user_id: id(7), blocked: false } },
    { body: { users: [{ user_id: id(7), name: '니나', created_at: '2026-09-23T03:00:00Z' }] } },
  ]);
  assert.equal((await api.likeEntry(id(2), true)).like_count, 6);
  await api.likeEntry(id(2), false);
  await api.saveEntry(id(2), true);
  assert.equal((await api.listSavedEntries()).saved_count, 1);
  assert.equal((await api.listComments(id(2))).comments[1].status, 'hidden');
  await api.createComment(id(2), { request_id: id(23), body: '좋아요' });
  await api.deleteComment(id(4));
  await api.createReport({ request_id: id(24), target_type: 'entry', target_id: id(2), reason: 'spam' });
  await api.blockUser(id(7), true);
  await api.blockUser(id(7), false);
  assert.equal((await api.listBlocks()).users[0].name, '니나');
  assert.deepEqual(calls.map(call => `${call.method} ${call.path}`).slice(0, 3),
    [`put /v2/entries/${id(2)}/like`, `delete /v2/entries/${id(2)}/like`, `put /v2/entries/${id(2)}/save`]);
});

test('알림함은 서버 응답을 그대로 읽는다', async t => {
  const calls = httpResponses(t, [
    { body: { groups: [group(), group({ group_key: 'g2', kind: 'challenge_ended', entry_id: null, actor_count: 0, actor_name: null })], next_cursor: null } },
    { status: 204 },
    { status: 204 },
    { body: { count: 2 } },
  ]);
  const inbox = await api.listNotifications();
  assert.equal(inbox.groups[0].actor_count, 3);
  await api.readNotifications({ group_keys: [inbox.groups[0].group_key] });
  await api.readNotifications({ all_before: { created_at: inbox.groups[0].latest_at, id: inbox.groups[0].group_key } });
  assert.equal((await api.unreadNotificationCount()).count, 2);
});
