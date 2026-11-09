import assert from 'node:assert/strict';
import test from 'node:test';

import { registrablePlatform } from '../lib/push-policy.ts';

test('푸시: 서버 계약에 있는 플랫폼(ios·android)만 등록을 시도한다', () => {
  assert.equal(registrablePlatform('ios'), 'ios');
  assert.equal(registrablePlatform('android'), 'android');
  assert.equal(registrablePlatform('web'), null);
  assert.equal(registrablePlatform('windows'), null);
});
