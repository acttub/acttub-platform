import assert from 'node:assert/strict';
import test from 'node:test';

import {
  REMINDER_AFTER_DAYS,
  REMINDER_BODY,
  REMINDER_TITLE,
  parseEnabled,
  registrablePlatform,
  reminderDelaySeconds,
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

test('리마인드: 마지막 연습에서 3일 뒤에 울린다', () => {
  assert.equal(REMINDER_AFTER_DAYS, 3);
  assert.equal(reminderDelaySeconds(), 3 * 24 * 60 * 60);
  assert.equal(reminderDelaySeconds(1), 86_400);
});

test('리마인드: 문구가 간격과 어긋나면 거짓말이 된다', () => {
  // 문구가 "3일" 을 말하므로 간격을 바꾸면 문구도 함께 바꿔야 한다.
  assert.ok(REMINDER_TITLE.includes(`${REMINDER_AFTER_DAYS}일`));
  assert.ok(REMINDER_BODY.length > 0);
});

test('푸시: 서버 계약에 있는 플랫폼(ios·android)만 등록을 시도한다', () => {
  assert.equal(registrablePlatform('ios'), 'ios');
  assert.equal(registrablePlatform('android'), 'android');
  assert.equal(registrablePlatform('web'), null);
  assert.equal(registrablePlatform('windows'), null);
});
