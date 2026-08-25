import assert from 'node:assert/strict';
import test from 'node:test';

import {
  NUDGE_BODY,
  NUDGE_HOUR,
  NUDGE_TITLE,
  NUDGE_WINDOW_DAYS,
  localDayKey,
  nudgeFireDates,
  parseEnabled,
  practicedToday,
  registrablePlatform,
} from '../lib/push-policy.ts';

test('푸시: 한 번도 고른 적 없으면(null) 켜짐이 기본이다', () => {
  assert.equal(parseEnabled(null), true);
});

test('푸시: 명시적으로 false 를 저장했을 때만 꺼짐이다', () => {
  assert.equal(parseEnabled('false'), false);
  assert.equal(parseEnabled('true'), true);
  // 알 수 없는 값(깨진 저장소)은 기본값(켜짐)으로 굴러간다.
  assert.equal(parseEnabled('garbage'), true);
});

test('넛지: 오늘 연습 안 했고 8시 전이면 오늘 저녁 8시부터 시작한다', () => {
  const now = new Date(2026, 7, 25, 14, 0, 0); // 8월 25일 14:00
  const dates = nudgeFireDates(now, false);
  assert.equal(dates.length, NUDGE_WINDOW_DAYS);
  assert.equal(localDayKey(dates[0]), '2026-08-25');
  assert.equal(dates[0].getHours(), NUDGE_HOUR);
  assert.equal(dates[0].getMinutes(), 0);
});

test('넛지: 오늘 연습을 했으면 내일 8시부터 시작한다', () => {
  const now = new Date(2026, 7, 25, 14, 0, 0);
  const dates = nudgeFireDates(now, true);
  assert.equal(localDayKey(dates[0]), '2026-08-26');
});

test('넛지: 이미 8시가 지났으면 (연습 여부와 무관하게) 내일부터다', () => {
  const now = new Date(2026, 7, 25, 21, 30, 0);
  assert.equal(localDayKey(nudgeFireDates(now, false)[0]), '2026-08-26');
  assert.equal(localDayKey(nudgeFireDates(now, true)[0]), '2026-08-26');
});

test('넛지: 하루 간격으로 이어지고 월 경계를 넘는다', () => {
  const now = new Date(2026, 7, 30, 10, 0, 0); // 8월 30일
  const dates = nudgeFireDates(now, false, 4);
  assert.deepEqual(dates.map(localDayKey), ['2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02']);
  for (const d of dates) assert.equal(d.getHours(), NUDGE_HOUR);
});

test('넛지: 오늘 연습했는지는 로컬 날짜 열쇠로 가른다', () => {
  const now = new Date(2026, 7, 25, 23, 59, 0);
  assert.equal(practicedToday('2026-08-25', now), true);
  assert.equal(practicedToday('2026-08-24', now), false);
  assert.equal(practicedToday(null, now), false);
});

test('넛지: 문구가 비어 있으면 알림이 무의미하다', () => {
  assert.ok(NUDGE_TITLE.length > 0);
  assert.ok(NUDGE_BODY.length > 0);
});

test('푸시: 서버 계약에 있는 플랫폼(ios·android)만 등록을 시도한다', () => {
  assert.equal(registrablePlatform('ios'), 'ios');
  assert.equal(registrablePlatform('android'), 'android');
  assert.equal(registrablePlatform('web'), null);
  assert.equal(registrablePlatform('windows'), null);
});
