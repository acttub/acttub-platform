import assert from 'node:assert/strict';
import test from 'node:test';

import {
  NOTIFICATION_PAGE_SIZE,
  badgeText,
  challengePushTarget,
  groupLabel,
  markAllRead,
  markGroupRead,
  sortGroups,
  targetOf,
  toggleOffNotice,
  unavailableMessage,
  unreadBadge,
} from '../lib/challenge/notification-center.ts';

const group = (over = {}) => ({
  group_key: 'g1',
  kind: 'entry_liked',
  actor_count: 1,
  actor_name: '윤서',
  challenge_id: 'challenge-1',
  entry_id: 'entry-1',
  comment_id: null,
  latest_at: '2026-09-21T02:00:00Z',
  read: false,
  target_available: true,
  ...over,
});

test('challenge.notification: 묶음 한 줄은 인원·댓글 수를 말한다', () => {
  assert.match(groupLabel(group({ actor_count: 30 })), /30/);
  assert.match(groupLabel(group({ kind: 'entry_commented', actor_count: 4 })), /4/);
  // 종료·리포트 완료는 수를 말하지 않는다.
  assert.doesNotMatch(groupLabel(group({ kind: 'challenge_ended', actor_count: 1 })), /1/);
  assert.notEqual(groupLabel(group({ kind: 'entry_ai_report_ready' })), groupLabel(group({ kind: 'challenge_ended' })));
});

test('challenge.notification: 목록은 묶음의 최신 사건 순이고 20개씩이다', () => {
  const sorted = sortGroups([
    group({ group_key: 'a', latest_at: '2026-09-20T02:00:00Z' }),
    group({ group_key: 'b', latest_at: '2026-09-21T02:00:00Z' }),
    group({ group_key: 'c', latest_at: '2026-09-19T02:00:00Z' }),
  ]);

  assert.deepEqual(sorted.map((g) => g.group_key), ['b', 'a', 'c']);
  assert.equal(NOTIFICATION_PAGE_SIZE, 20);
});

test('challenge.notification: 배지는 읽지 않은 묶음 수다(사건 수가 아니다)', () => {
  const groups = [
    group({ group_key: 'a', actor_count: 30, read: false }),
    group({ group_key: 'b', actor_count: 2, read: false }),
    group({ group_key: 'c', read: true }),
  ];

  assert.equal(unreadBadge(groups), 2);
  assert.equal(badgeText(2), '2');
  assert.equal(badgeText(0), null);
  assert.equal(badgeText(120), '99+');
});

test('challenge.notification: 묶음을 열면 그 묶음이 읽음이 되고 모두 읽음은 그 시각까지만이다', () => {
  const groups = [
    group({ group_key: 'new', latest_at: '2026-09-21T05:00:00Z' }),
    group({ group_key: 'old', latest_at: '2026-09-21T01:00:00Z' }),
  ];

  assert.deepEqual(markGroupRead(groups, 'old').map((g) => g.read), [false, true]);
  // 모두 읽음(2026-09-21T02:00:00Z) 뒤에 도착한 것은 읽지 않음으로 남는다.
  const afterAll = markAllRead(groups, { at: '2026-09-21T02:00:00Z', groupKey: 'zzz' });
  assert.deepEqual(afterAll.map((g) => g.read), [false, true]);
});

test('challenge.notification: 묶음을 누르면 대상으로 가고 볼 수 없으면 안내만 한다', () => {
  assert.deepEqual(targetOf(group()), { kind: 'entry', challengeId: 'challenge-1', entryId: 'entry-1' });
  assert.deepEqual(targetOf(group({ kind: 'challenge_ended', entry_id: null })), {
    kind: 'challenge',
    challengeId: 'challenge-1',
  });
  // 비공개·삭제·숨김·차단으로 보이지 않으면 이동하지 않는다.
  assert.deepEqual(targetOf(group({ target_available: false })), { kind: 'unavailable' });
  assert.match(unavailableMessage(), /볼 수 없는/);
  // 내가 요청한 AI 리포트는 비공개 참여작이어도 열린다.
  assert.deepEqual(targetOf(group({ kind: 'entry_ai_report_ready', target_available: false })), {
    kind: 'report',
    entryId: 'entry-1',
  });
});

test('challenge.notification: 토글을 꺼도 알림함에는 쌓인다고 알린다', () => {
  assert.equal(toggleOffNotice(true), null);
  assert.match(toggleOffNotice(false), /쌓여요/);
});

test('challenge.notification: 푸시에는 식별자만 있고 그것으로 알림함을 연다', () => {
  assert.deepEqual(challengePushTarget({ kind: 'challenge_notification', group_key: 'g1' }), { groupKey: 'g1' });
  assert.deepEqual(challengePushTarget({ type: 'challenge_notification', notification_id: 'n1' }), {
    notificationId: 'n1',
  });
  // 다른 푸시(분석 완료)는 여기서 열지 않는다.
  assert.equal(challengePushTarget({ kind: 'analysis_complete', practice_id: 'p1' }), null);
  assert.equal(challengePushTarget(null), null);
});
