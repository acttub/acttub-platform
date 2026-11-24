import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { memoryStorage } from './helpers/stub-modules.mjs';

const storage = memoryStorage();
globalThis.require = () => ({ default: storage });
const invite = await import('../lib/invite.ts');
const { ApiError } = await import('../lib/api-request.ts');

beforeEach(() => storage.values.clear());

test('입력한 글을 대문자로 바꾸고 코드에 없는 글자(0·O·1·I·띄어쓰기·하이픈)를 빼고 6자리에서 자른다', () => {
  assert.equal(invite.cleanInviteCode(' ab-c d ef '), 'ABCDEF');
  assert.equal(invite.cleanInviteCode('A0O1I2B'), 'A2B');
  assert.equal(invite.cleanInviteCode('ABCDEFGH'), 'ABCDEF');
  assert.equal(invite.cleanInviteCode('가나다'), '');
  assert.equal(invite.isInviteCode('ABC234'), true);
  assert.equal(invite.isInviteCode('ABC23'), false);
  assert.equal(invite.isInviteCode('ABC230'), false);
});

test('딥링크의 code 는 코드 모양일 때만 받는다', () => {
  assert.equal(invite.inviteCodeFromParam('abc234'), 'ABC234');
  assert.equal(invite.inviteCodeFromParam(['XYZ789', 'ABC234']), 'XYZ789');
  assert.equal(invite.inviteCodeFromParam('abc'), null);
  assert.equal(invite.inviteCodeFromParam(undefined), null);
});

test('공유 글은 소개·코드·보상 조건 뒤에 두 스토어 주소를 싣고, 모르는 주소는 뺀다', () => {
  const base = { code: 'ABC234', intro: '같이 연습해요', codeLine: '초대 코드 ABC234', reward: '둘 다 Pro 1개월' };
  assert.equal(
    invite.inviteShareMessage({ ...base, androidPackage: 'com.acttub.app', iosAppStoreUrl: 'https://apps.apple.com/app/id1' }),
    '같이 연습해요\n초대 코드 ABC234\n둘 다 Pro 1개월\nhttps://apps.apple.com/app/id1\nhttps://play.google.com/store/apps/details?id=com.acttub.app',
  );
  assert.equal(
    invite.inviteShareMessage({ ...base, androidPackage: undefined, iosAppStoreUrl: '' }),
    '같이 연습해요\n초대 코드 ABC234\n둘 다 Pro 1개월',
  );
});

test('코드 넣기 실패는 서버 사유 코드마다 하나의 사유로, 나머지는 상태로 나눈다', () => {
  const failed = (status, code) => new ApiError(status, code, code);
  assert.equal(invite.redeemFailReason(failed(404, 'invite_code_not_found')), 'not_found');
  assert.equal(invite.redeemFailReason(failed(409, 'own_invite_code')), 'own_code');
  assert.equal(invite.redeemFailReason(failed(409, 'invite_already_redeemed')), 'already');
  assert.equal(invite.redeemFailReason(failed(409, 'invite_window_closed')), 'window_closed');
  assert.equal(invite.redeemFailReason({ status: 429, code: 'rate limit exceeded' }), 'rate_limited');
  assert.equal(invite.redeemFailReason({ status: 503 }), 'network');
  assert.equal(invite.redeemFailReason(new Error('offline')), 'network');
  assert.equal(invite.redeemFailReason({ status: 404, code: 'invite_unavailable' }), 'unknown');
});

test('딥링크로 받은 코드는 한 번만 꺼내지고, 코드 모양이 아니면 버린다', async () => {
  await invite.rememberPendingInviteCode('ABC234');
  assert.equal(await invite.takePendingInviteCode(), 'ABC234');
  assert.equal(await invite.takePendingInviteCode(), null);

  storage.values.set('acttub.invite.pendingCode', 'bad');
  assert.equal(await invite.takePendingInviteCode(), null);
  assert.equal(storage.values.has('acttub.invite.pendingCode'), false);
});

test('보상 수가 늘어난 만큼만 센다 — 처음 본 계정은 0에서 센다', async () => {
  assert.equal(await invite.newRewardsSinceSeen('u1', 0), 0);
  assert.equal(await invite.newRewardsSinceSeen('u1', 1), 1);
  assert.equal(await invite.newRewardsSinceSeen('u1', 1), 0);
  assert.equal(await invite.newRewardsSinceSeen('u1', 3), 2);
  assert.equal(await invite.newRewardsSinceSeen('u2', 2), 2);
});

test('기기 저장소를 못 쓰면 조용히 넘어간다', async () => {
  const broken = { getItem: async () => { throw new Error('x'); }, setItem: async () => { throw new Error('x'); }, removeItem: async () => {} };
  globalThis.require = () => ({ default: broken });
  try {
    await invite.rememberPendingInviteCode('ABC234');
    assert.equal(await invite.takePendingInviteCode(), null);
    assert.equal(await invite.newRewardsSinceSeen('u1', 1), 0);
  } finally {
    globalThis.require = () => ({ default: storage });
  }
});
