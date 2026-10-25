import assert from 'node:assert/strict';
import test from 'node:test';

import {
  confirmMessage,
  confirmPurchase,
  needsRecovery,
  pickOfferToken,
  recoveryDue,
  retryable,
  STORE_PRODUCT_ID,
  verifyBody,
} from '../lib/store-billing.ts';

const me = { status: 'active', pro: true, provider: 'apple', app_enabled: true };
const apiError = (status, code) => Object.assign(new Error(code ?? 'x'), { status, code });
const noSleep = async () => {};

test('검증 요청 본문 — iOS 는 거래 JWS, Android 는 구매 토큰, 영수증이 비면 만들지 않는다', () => {
  assert.deepEqual(verifyBody('ios', { productId: STORE_PRODUCT_ID, purchaseToken: ' jws ' }), {
    platform: 'ios',
    product_id: 'acttub_pro_monthly',
    signed_transaction: 'jws',
  });
  assert.deepEqual(verifyBody('android', { productId: STORE_PRODUCT_ID, purchaseToken: 'tok' }), {
    platform: 'android',
    product_id: 'acttub_pro_monthly',
    purchase_token: 'tok',
  });
  assert.equal(verifyBody('ios', { productId: STORE_PRODUCT_ID, purchaseToken: '  ' }), null);
  assert.equal(verifyBody('android', { productId: STORE_PRODUCT_ID }), null);
});

test('오퍼 토큰 — monthly 기본 요금제의 오퍼를 고르고 없으면 null', () => {
  assert.equal(
    pickOfferToken([
      { id: 'promo', basePlanIdAndroid: 'monthly', offerTokenAndroid: 'tok-promo' },
      { id: 'monthly', basePlanIdAndroid: 'monthly', offerTokenAndroid: 'tok-base' },
      { id: 'x', basePlanIdAndroid: 'yearly', offerTokenAndroid: 'tok-year' },
    ]),
    'tok-base',
  );
  assert.equal(pickOfferToken([{ id: 'promo', basePlanIdAndroid: 'monthly', offerTokenAndroid: 'only' }]), 'only');
  assert.equal(pickOfferToken([{ id: 'x', basePlanIdAndroid: 'yearly', offerTokenAndroid: 't' }]), null);
  assert.equal(pickOfferToken(null), null);
});

test('서버가 OK 한 뒤에만 iOS 거래를 끝낸다', async () => {
  const calls = [];
  const result = await confirmPurchase(
    { productId: STORE_PRODUCT_ID, purchaseToken: 'jws' },
    {
      platform: 'ios',
      verify: async (body) => {
        calls.push(['verify', body.signed_transaction]);
        return me;
      },
      finish: async () => calls.push(['finish']),
      sleep: noSleep,
    },
  );
  assert.equal(result.outcome, 'confirmed');
  assert.deepEqual(calls, [['verify', 'jws'], ['finish']]);
});

test('Android 거래는 앱이 끝내지 않는다(승인은 서버가 한다)', async () => {
  let finished = 0;
  const result = await confirmPurchase(
    { productId: STORE_PRODUCT_ID, purchaseToken: 'tok' },
    { platform: 'android', verify: async () => me, finish: async () => void (finished += 1), sleep: noSleep },
  );
  assert.equal(result.outcome, 'confirmed');
  assert.equal(finished, 0);
});

test('네트워크·서버 오류는 다시 시도하고, 끝내 안 되면 거래를 끝내지 않고 retry', async () => {
  let attempts = 0;
  let finished = 0;
  const flaky = await confirmPurchase(
    { productId: STORE_PRODUCT_ID, purchaseToken: 'jws' },
    {
      platform: 'ios',
      verify: async () => {
        attempts += 1;
        if (attempts < 3) throw apiError(503, 'store_unavailable');
        return me;
      },
      finish: async () => void (finished += 1),
      sleep: noSleep,
    },
  );
  assert.equal(flaky.outcome, 'confirmed');
  assert.equal(attempts, 3);
  assert.equal(finished, 1);

  attempts = 0;
  finished = 0;
  const down = await confirmPurchase(
    { productId: STORE_PRODUCT_ID, purchaseToken: 'jws' },
    {
      platform: 'ios',
      verify: async () => {
        attempts += 1;
        throw new Error('offline');
      },
      finish: async () => void (finished += 1),
      sleep: noSleep,
    },
  );
  assert.equal(down.outcome, 'retry');
  assert.equal(attempts, 3);
  assert.equal(finished, 0);
});

test('서버가 거절하면(다른 계정·이미 구독 중·영수증 불량) 다시 보내지 않고 거래를 끝내지 않는다', async () => {
  for (const code of ['store_account_mismatch', 'store_account_conflict', 'already_subscribed', 'invalid_store_receipt']) {
    let attempts = 0;
    let finished = 0;
    const result = await confirmPurchase(
      { productId: STORE_PRODUCT_ID, purchaseToken: 'jws' },
      {
        platform: 'ios',
        verify: async () => {
          attempts += 1;
          throw apiError(code === 'invalid_store_receipt' ? 422 : code === 'store_account_mismatch' ? 403 : 409, code);
        },
        finish: async () => void (finished += 1),
        sleep: noSleep,
      },
    );
    assert.equal(result.outcome, 'rejected');
    assert.equal(result.code, code);
    assert.equal(attempts, 1);
    assert.equal(finished, 0);
  }
});

test('결제 대기(payment_pending)는 pending 이고 거래를 남긴다. 영수증이 비면 rejected', async () => {
  const pending = await confirmPurchase(
    { productId: STORE_PRODUCT_ID, purchaseToken: 'tok' },
    {
      platform: 'android',
      verify: async () => {
        throw apiError(409, 'payment_pending');
      },
      finish: async () => {},
      sleep: noSleep,
    },
  );
  assert.equal(pending.outcome, 'pending');
  const empty = await confirmPurchase(
    { productId: STORE_PRODUCT_ID },
    { platform: 'ios', verify: async () => me, finish: async () => {}, sleep: noSleep },
  );
  assert.equal(empty.outcome, 'rejected');
});

test('재시도 판정과 사용자 문구', () => {
  assert.equal(retryable(apiError(500)), true);
  assert.equal(retryable(apiError(429)), true);
  assert.equal(retryable(new Error('offline')), true);
  assert.equal(retryable(apiError(409, 'x')), false);
  assert.equal(confirmMessage({ outcome: 'confirmed' }), null);
  assert.match(confirmMessage({ outcome: 'rejected', code: 'store_account_mismatch' }), /다른 ACTTUB 계정/);
  assert.match(confirmMessage({ outcome: 'rejected', code: 'already_subscribed' }), /이미 Pro/);
  assert.match(confirmMessage({ outcome: 'pending' }), /아직 끝나지 않았어요/);
  assert.match(confirmMessage({ outcome: 'retry' }), /다시 열면 자동으로/);
  assert.match(confirmMessage({ outcome: 'rejected', code: 'invalid_store_receipt' }), /확인하지 못했어요/);
});

test('시작 복구 — 서버가 앱 결제를 열었고 아직 Pro 가 아닐 때만, 30초 안에는 다시 돌지 않는다', () => {
  assert.equal(needsRecovery({ ...me, pro: false }), true);
  assert.equal(needsRecovery(me), false);
  assert.equal(needsRecovery({ ...me, pro: false, app_enabled: false }), false);
  assert.equal(needsRecovery(null), false);
  assert.equal(recoveryDue(null, 1000), true);
  assert.equal(recoveryDue(1000, 20_000), false);
  assert.equal(recoveryDue(1000, 31_000), true);
});
