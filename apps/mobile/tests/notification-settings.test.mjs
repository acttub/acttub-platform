import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_NOTIFICATION_SETTINGS,
  legacyOptOutPatch,
  notificationEffects,
  parseNotificationSettings,
  permissionPrompt,
  wantsServerPush,
} from '../lib/push-policy.ts';

const ALL_ON = { analysis_done: true, challenge: true, evening_reminder: true };

test('account.notification: 가입 직후 설정을 열면 토글 셋이 모두 켜져 있다', () => {
  assert.deepEqual(DEFAULT_NOTIFICATION_SETTINGS, ALL_ON);
  // 서버 값을 아직 못 받았고 기기에 적어 둔 값도 없으면 기본값이다.
  assert.deepEqual(parseNotificationSettings(null), ALL_ON);
  assert.deepEqual(parseNotificationSettings('깨진 값'), ALL_ON);
  assert.deepEqual(
    parseNotificationSettings(JSON.stringify({ analysis_done: false, challenge: true, evening_reminder: false })),
    { analysis_done: false, challenge: true, evening_reminder: false },
  );
});

test('account.notification: 토글 하나만 꺼져 있으면 이 폰의 토큰은 두고 서버가 거른다', () => {
  const next = { ...ALL_ON, analysis_done: false };

  assert.equal(wantsServerPush(next), true);
  assert.deepEqual(notificationEffects(ALL_ON, next), {
    registerToken: false,
    forgetToken: false,
    scheduleReminders: false,
    cancelReminders: false,
  });
});

test('account.notification: 푸시 토글 둘을 다 끄면 이 폰의 토큰 기록을 버리고, 하나를 다시 켜면 다시 등록한다', () => {
  const challengeOnly = { ...ALL_ON, analysis_done: false };
  const bothOff = { ...challengeOnly, challenge: false };

  assert.equal(wantsServerPush(bothOff), false);
  // 서버가 그 회원의 토큰을 전부 지운다. 앱은 남은 기록을 버려 다시 켤 때 새로 등록하게 한다.
  assert.equal(notificationEffects(challengeOnly, bothOff).forgetToken, true);
  assert.equal(notificationEffects(challengeOnly, bothOff).registerToken, false);

  const oneBackOn = { ...bothOff, analysis_done: true };
  assert.equal(notificationEffects(bothOff, oneBackOn).registerToken, true);
  assert.equal(notificationEffects(bothOff, oneBackOn).forgetToken, false);
});

test('account.notification: 리마인드 토글을 끄면 예약된 알람을 전부 취소하고, 켜면 다시 30일치를 맞춘다', () => {
  const off = { ...ALL_ON, evening_reminder: false };

  assert.deepEqual(notificationEffects(ALL_ON, off), {
    registerToken: false,
    forgetToken: false,
    scheduleReminders: false,
    cancelReminders: true,
  });
  assert.equal(notificationEffects(off, ALL_ON).scheduleReminders, true);
  assert.equal(notificationEffects(off, ALL_ON).cancelReminders, false);
  // 리마인드는 폰이 스스로 울린다. 서버 푸시 토큰과는 무관하다.
  assert.equal(notificationEffects(ALL_ON, off).forgetToken, false);
});

test('account.notification: 알림 권한이 꺼진 폰에서 토글을 켜면 권한 설정 안내가 뜬다', () => {
  // 아직 물어볼 수 있으면 OS 권한 창을 띄운다.
  assert.equal(permissionPrompt({ turningOn: true, granted: false, canAskAgain: true }), 'request');
  // 이미 거절해 다시 물을 수 없으면 설정 앱으로 안내한다.
  assert.equal(permissionPrompt({ turningOn: true, granted: false, canAskAgain: false }), 'open_settings');
  assert.equal(permissionPrompt({ turningOn: true, granted: true, canAskAgain: false }), 'none');
  // 끄는 데는 권한이 필요 없다.
  assert.equal(permissionPrompt({ turningOn: false, granted: false, canAskAgain: false }), 'none');
});

test('account.notification: 1.0.0 이전에 알림을 꺼 둔 사람은 업데이트 뒤에도 셋 다 꺼진 채로 시작한다', () => {
  assert.deepEqual(legacyOptOutPatch('false'), {
    analysis_done: false,
    challenge: false,
    evening_reminder: false,
  });
  assert.equal(legacyOptOutPatch('true'), null);
  assert.equal(legacyOptOutPatch(null), null);
});
