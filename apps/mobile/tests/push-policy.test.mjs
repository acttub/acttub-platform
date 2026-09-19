import assert from 'node:assert/strict';
import test from 'node:test';

import {
  NUDGE_BODY,
  NUDGE_HOUR,
  NUDGE_TITLE,
  NUDGE_WINDOW_DAYS,
  localDayKey,
  nudgeFireDates,
  practicedToday,
  registrablePlatform,
} from '../lib/push-policy.ts';

test('account.notification: 저녁 리마인드는 폰 시각 밤 10시에 30일치를 맞춘다', () => {
  assert.equal(NUDGE_HOUR, 22);
  assert.equal(NUDGE_WINDOW_DAYS, 30);

  const now = new Date(2026, 7, 25, 14, 0, 0); // 8월 25일 14:00
  const dates = nudgeFireDates(now, false);
  assert.equal(dates.length, 30);
  assert.equal(localDayKey(dates[0]), '2026-08-25');
  assert.equal(localDayKey(dates[29]), '2026-09-23');
  for (const d of dates) {
    assert.equal(d.getHours(), 22);
    assert.equal(d.getMinutes(), 0);
  }
  // iOS는 앱마다 예약 알림을 64개까지만 둔다.
  assert.ok(dates.length <= 64);
});

test('account.notification: 오늘 연습하면 오늘 밤 10시 알람만 없고 내일 밤 10시는 있다', () => {
  const now = new Date(2026, 7, 25, 14, 0, 0);
  const before = nudgeFireDates(now, false).map(localDayKey);
  const after = nudgeFireDates(now, true).map(localDayKey);

  assert.equal(before[0], '2026-08-25');
  assert.equal(after.includes('2026-08-25'), false);
  assert.equal(after[0], '2026-08-26');
  assert.equal(after.length, 30);
});

test('account.notification: 30일 동안 앱을 안 열면 31일째 저녁에는 알람이 없다', () => {
  const now = new Date(2026, 7, 25, 14, 0, 0);
  const days = nudgeFireDates(now, false).map(localDayKey);

  assert.equal(days.includes('2026-09-23'), true); // 30일째
  assert.equal(days.includes('2026-09-24'), false); // 31일째
});

test('account.notification: 이미 밤 10시가 지났으면 (연습 여부와 무관하게) 내일부터다', () => {
  const now = new Date(2026, 7, 25, 22, 30, 0);
  assert.equal(localDayKey(nudgeFireDates(now, false)[0]), '2026-08-26');
  assert.equal(localDayKey(nudgeFireDates(now, true)[0]), '2026-08-26');
});

test('넛지: 하루 간격으로 이어지고 월 경계를 넘는다', () => {
  const now = new Date(2026, 7, 30, 10, 0, 0); // 8월 30일
  const dates = nudgeFireDates(now, false, 4);
  assert.deepEqual(dates.map(localDayKey), ['2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02']);
  for (const d of dates) assert.equal(d.getHours(), NUDGE_HOUR);
});

test('account.notification: 리마인드 문구는 연습 권유만 담고 홍보를 섞지 않는다', async () => {
  const { default: ko } = await import('../locales/ko.ts');
  const { default: en } = await import('../locales/en.ts');
  // 이벤트·홍보를 섞으면 광고성 정보가 되어 밤 9시 이후 전송 제한에 걸린다.
  const promotional = /이벤트|할인|혜택|쿠폰|프로모션|무료|특가|구독|결제|신규 기능|업데이트|event|sale|discount|coupon|promo|free|offer|subscribe/i;
  for (const text of [ko.nudge.title, ko.nudge.body, en.nudge.title, en.nudge.body]) {
    assert.doesNotMatch(text, promotional);
  }
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
