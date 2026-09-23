import assert from 'node:assert/strict';
import test from 'node:test';

import {
  avatarLetter,
  canDelete,
  browseFailure,
  dDayLabel,
  hostLabel,
  isEnded,
  moderationNotice,
  participantsLabel,
  pinsFeatured,
  firstBadgeLabel,
  rankEntries,
  rankingNotice,
  ranksHidden,
  searchable,
} from '../lib/challenge/browse.ts';

const entry = (id, likes, publishedAt, over = {}) => ({
  id,
  author: { name: `배우${id}` },
  caption: null,
  like_count: likes,
  comment_count: 0,
  view_count: 0,
  rank: null,
  final_like_count: null,
  published_at: publishedAt,
  playback_url: null,
  liked: false,
  saved: false,
  is_mine: false,
  is_new: false,
  ...over,
});

test('challenge.browse: 좋아요순은 서버가 준 순서와 공동 순위 그대로이고 1위에만 배지다', () => {
  const ranked = rankEntries(
    [
      entry('a', 5, '2026-09-19T02:00:00Z', { rank: 1 }),
      entry('b', 3, '2026-09-19T05:00:00Z', { rank: 2 }),
      entry('c', 3, '2026-09-20T02:00:00Z', { rank: 2 }),
    ],
    'likes',
  );

  assert.deepEqual(ranked.map((e) => e.id), ['a', 'b', 'c']);
  assert.deepEqual(ranked.map((e) => e.displayRank), [1, 2, 2]);
  assert.deepEqual(ranked.map((e) => e.showsFirstBadge), [true, false, false]);
});

test('challenge.browse: 10분 동안 굳힌 순서는 그 사이 좋아요가 뒤집혀도 다시 정렬하지 않는다', () => {
  // 서버가 첫 조회 때 순서를 굳혀 두었다 — 2위가 그 뒤 좋아요로 1위를 넘어도 이어지는 쪽은 처음 순서다.
  const ranked = rankEntries(
    [entry('a', 5, '2026-09-19T02:00:00Z', { rank: 1 }), entry('b', 9, '2026-09-19T05:00:00Z', { rank: 2 })],
    'likes',
  );

  assert.deepEqual(ranked.map((e) => e.id), ['a', 'b']);
  assert.deepEqual(ranked.map((e) => e.displayRank), [1, 2]);
});

test('challenge.browse: 좋아요가 모두 0이면 서버가 순위를 주지 않아 1위 배지가 없다', () => {
  const ranked = rankEntries([entry('a', 0, '2026-09-19T02:00:00Z'), entry('b', 0, '2026-09-20T02:00:00Z')], 'likes');

  assert.deepEqual(ranked.map((e) => e.displayRank), [null, null]);
  assert.equal(ranked.some((e) => e.showsFirstBadge), false);
});

test('challenge.browse: 최신순은 순위 숫자가 없고 NEW 는 서버가 가장 최근 하나에만 붙인다', () => {
  const ranked = rankEntries(
    [entry('b', 1, '2026-09-21T02:00:00Z', { is_new: true }), entry('c', 4, '2026-09-20T02:00:00Z'), entry('a', 9, '2026-09-19T02:00:00Z')],
    'latest',
  );
  const nextPage = rankEntries([entry('d', 2, '2026-09-18T02:00:00Z')], 'latest');

  assert.deepEqual(ranked.map((e) => e.id), ['b', 'c', 'a']);
  assert.deepEqual(ranked.map((e) => e.displayRank), [null, null, null]);
  assert.deepEqual(ranked.map((e) => e.isNew), [true, false, false]);
  assert.equal(nextPage[0].isNew, false);
  assert.equal(ranked.some((e) => e.showsFirstBadge), false);
});

test('challenge.browse: 서버가 준 순위는 차단으로 빠진 참여작이 있어도 전체 기준 그대로다', () => {
  const ranked = rankEntries(
    [entry('a', 5, '2026-09-19T02:00:00Z', { rank: 1 }), entry('c', 3, '2026-09-20T02:00:00Z', { rank: 3 })],
    'likes',
  );

  assert.deepEqual(ranked.map((e) => e.displayRank), [1, 3]);
});

test('challenge.browse: 종료 뒤 1위 배지는 마감 때 저장된 좋아요 수다', () => {
  const winner = entry('a', 12, '2026-09-19T02:00:00Z', { rank: 1, final_like_count: 10 });

  assert.match(firstBadgeLabel(winner, true), /10/);
  assert.doesNotMatch(firstBadgeLabel(winner, true), /12/);
  assert.match(firstBadgeLabel(winner, false), /12/);
});

test('challenge.browse: 종료된 챌린지는 확정 전까지 "집계 중"이고 순위를 감춘다', () => {
  const now = Date.parse('2026-09-21T00:00:00Z');
  const running = { ends_at: '2026-09-25T00:00:00Z', ranking_state: null };
  const pending = { ends_at: '2026-09-20T00:00:00Z', ranking_state: 'pending' };
  const done = { ends_at: '2026-09-20T00:00:00Z', ranking_state: 'final' };

  assert.equal(isEnded(running, now), false);
  assert.equal(rankingNotice(running, now), null);
  assert.equal(ranksHidden(running, now), false);
  assert.match(rankingNotice(pending, now), /집계/);
  assert.equal(ranksHidden(pending, now), true);
  assert.equal(ranksHidden(done, now), false);
  assert.notEqual(rankingNotice(done, now), null);
});

test('challenge.browse: 진행 중은 D-N, 끝났으면 종료로 보인다', () => {
  const now = Date.parse('2026-09-21T00:00:00Z');

  assert.match(dDayLabel({ ends_at: '2026-09-24T00:00:00Z' }, now), /3/);
  assert.match(dDayLabel({ ends_at: '2026-09-21T06:00:00Z' }, now), /1/);
  assert.doesNotMatch(dDayLabel({ ends_at: '2026-09-20T00:00:00Z' }, now), /D-/);
});

test('challenge.browse: 오늘의 챌린지는 인기·최신 탭에만 고정한다', () => {
  assert.equal(pinsFeatured('popular'), true);
  assert.equal(pinsFeatured('latest'), true);
  assert.equal(pinsFeatured('ended'), false);
  assert.equal(pinsFeatured('mine'), false);
});

test('challenge.browse: 검색은 2자 이상일 때만 찾는다', () => {
  assert.equal(searchable('니'), false);
  assert.equal(searchable(' 니 '), false);
  assert.equal(searchable('니나'), true);
});

test('challenge.browse: 참여자는 이름 셋과 +N 으로 보이고 아바타는 첫 글자다', () => {
  assert.equal(participantsLabel([{ name: '윤서' }, { name: '태오' }, { name: '민재' }], 12), '윤서 · 태오 · 민재 +12');
  assert.equal(participantsLabel([{ name: '윤서' }], 0), '윤서');
  assert.equal(avatarLetter('윤서'), '윤');
  assert.equal(avatarLetter(' 태오 '), '태');
  // 참여자가 없으면 없다고 말한다.
  assert.notEqual(participantsLabel([], 0), '');
});

test('challenge.browse: 주최자는 기획팀·회원·탈퇴로 갈려 보인다', () => {
  assert.notEqual(hostLabel({ origin: 'team', host_name: null }), hostLabel({ origin: 'member', host_name: '윤서' }));
  assert.match(hostLabel({ origin: 'member', host_name: '윤서' }), /윤서/);
  // 주최자가 탈퇴해도 기획팀 챌린지로 보이지 않는다.
  const withdrawn = hostLabel({ origin: 'member', host_name: null });
  assert.notEqual(withdrawn, hostLabel({ origin: 'team', host_name: null }));
  assert.match(withdrawn, /탈퇴/);
});

test('challenge.browse: 운영 검토·숨김은 그렇게 알리고 보통은 안내가 없다', () => {
  assert.equal(moderationNotice({ moderation: 'visible' }), null);
  assert.notEqual(moderationNotice({ moderation: 'review' }), null);
  assert.notEqual(moderationNotice({ moderation: 'hidden' }), null);
});

test('challenge.create: 참여작이 없는 자기 챌린지만 지울 수 있다', () => {
  assert.equal(canDelete({ is_host: true, entry_count: 0 }), true);
  // 참여작이 생기면 지울 수 없고 운영 숨김만 있다.
  assert.equal(canDelete({ is_host: true, entry_count: 1 }), false);
  assert.equal(canDelete({ is_host: false, entry_count: 0 }), false);
  assert.equal(canDelete({ entry_count: 0 }), false);
});

test('challenge.browse: 게스트·만료 커서·없는 챌린지를 갈라 본다', () => {
  assert.deepEqual(browseFailure(Object.assign(new Error('x'), { status: 403, code: 'member_only' })), { kind: 'member_only' });
  assert.deepEqual(browseFailure(Object.assign(new Error('x'), { status: 410, code: 'cursor_expired' })), { kind: 'cursor_expired' });
  assert.deepEqual(browseFailure(Object.assign(new Error('x'), { status: 404 })), { kind: 'not_found' });
  assert.deepEqual(browseFailure(Object.assign(new Error('x'), { name: 'NetworkError' })), { kind: 'offline' });
});
