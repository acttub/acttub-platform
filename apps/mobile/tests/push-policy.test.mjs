import assert from 'node:assert/strict';
import test from 'node:test';

import { registrablePlatform } from '../lib/push-policy.ts';

test('account.notification: 설정은 서버 저녁 8시 리마인드를 설명한다', async () => {
  const { default: ko } = await import('../locales/ko.ts');
  const { default: en } = await import('../locales/en.ts');
  assert.equal(ko.settings.notifReminderBody, '오늘 연습이 없으면 저녁 8시에 한 번 알려드려요.');
  assert.equal(en.settings.notifReminderBody, "If you haven't practiced today, we'll remind you once at 8 PM.");
});

test('푸시: 서버 계약에 있는 플랫폼(ios·android)만 등록을 시도한다', () => {
  assert.equal(registrablePlatform('ios'), 'ios');
  assert.equal(registrablePlatform('android'), 'android');
  assert.equal(registrablePlatform('web'), null);
  assert.equal(registrablePlatform('windows'), null);
});
