import assert from 'node:assert/strict';
import test from 'node:test';

import {
  confirmMessage,
  needsRecovery,
  planPackage,
  planPrices,
  productPlan,
  purchaseCancelled,
  purchasePending,
  recoveryDue,
  retryable,
  revenueCatKey,
  syncPurchase,
} from '../lib/store-billing.ts';

const me = { status: 'active', pro: true, provider: 'apple', app_enabled: true };
const notPro = { ...me, status: 'none', pro: false, provider: null };
const apiError = (status, code) => Object.assign(new Error(code ?? 'x'), { status, code });
const noSleep = async () => {};
const pkg = (identifier, productId, priceString) => ({ identifier, product: { identifier: productId, priceString } });
const monthly = pkg('$rc_monthly', 'acttub_pro_monthly', '₩3,900');
const annual = pkg('$rc_annual', 'acttub_pro_yearly', '₩32,500');

test('오퍼링 — 월은 $rc_monthly, 연은 $rc_annual 패키지. 바로가기가 없으면 식별자로 찾고, 없는 요금제는 null', () => {
  assert.equal(planPackage({ monthly, annual }, 'monthly'), monthly);
  assert.equal(planPackage({ monthly, annual }, 'yearly'), annual);
  assert.equal(planPackage({ monthly: null, annual: null, availablePackages: [annual, monthly] }, 'monthly'), monthly);
  assert.equal(planPackage({ monthly, availablePackages: [monthly] }, 'yearly'), null);
  assert.equal(planPackage(null, 'monthly'), null);
  assert.deepEqual(planPrices({ monthly, annual }), { monthly: '₩3,900', yearly: '₩32,500' });
  assert.deepEqual(planPrices({ monthly }), { monthly: '₩3,900', yearly: null });
  assert.deepEqual(planPrices(null), { monthly: null, yearly: null });
});

test('상품 ID → 요금제(Google 의 구독ID:요금제ID 꼴 포함)', () => {
  assert.equal(productPlan('acttub_pro_monthly'), 'monthly');
  assert.equal(productPlan('acttub_pro_yearly:yearly'), 'yearly');
  assert.equal(productPlan('acttub_pro_weekly'), null);
  assert.equal(productPlan(null), null);
});

test('RevenueCat 공개 키 — 플랫폼별로 고르고 비어 있으면 null(그 빌드는 스토어 구매를 열지 않는다)', () => {
  const keys = { ios: ' appl_x ', android: '' };
  assert.equal(revenueCatKey('ios', keys), 'appl_x');
  assert.equal(revenueCatKey('android', keys), null);
  assert.equal(revenueCatKey(null, keys), null);
  assert.equal(revenueCatKey('android', {}), null);
});

test('SDK 오류 — 사용자 취소와 결제 대기를 가른다', () => {
  assert.equal(purchaseCancelled({ userCancelled: true }), true);
  assert.equal(purchaseCancelled({ code: '1' }), true);
  assert.equal(purchaseCancelled({ code: '2' }), false);
  assert.equal(purchaseCancelled(null), false);
  assert.equal(purchasePending({ code: '20' }), true);
  assert.equal(purchasePending({ code: '1' }), false);
});

test('구매 뒤 서버 동기화 — 서버가 Pro 라고 하면 confirmed', async () => {
  let calls = 0;
  const result = await syncPurchase({ sync: async () => (calls += 1, me), expectPro: true, sleep: noSleep });
  assert.equal(result.outcome, 'confirmed');
  assert.equal(result.me, me);
  assert.equal(calls, 1);
});

test('네트워크·서버 오류는 다시 시도하고, 끝내 안 되면 retry', async () => {
  let attempts = 0;
  const flaky = await syncPurchase({
    sync: async () => {
      attempts += 1;
      if (attempts < 3) throw apiError(503, 'store_unavailable');
      return me;
    },
    expectPro: true,
    sleep: noSleep,
  });
  assert.equal(flaky.outcome, 'confirmed');
  assert.equal(attempts, 3);

  attempts = 0;
  const down = await syncPurchase({
    sync: async () => {
      attempts += 1;
      throw new Error('offline');
    },
    expectPro: true,
    sleep: noSleep,
  });
  assert.equal(down.outcome, 'retry');
  assert.equal(attempts, 3);
});

test('결제 직후 서버가 아직 Pro 가 아니면 잠깐 뒤 다시 묻고, 끝내 아니면 retry. 복원이면 바로 none', async () => {
  let attempts = 0;
  const late = await syncPurchase({
    sync: async () => {
      attempts += 1;
      return attempts < 2 ? notPro : me;
    },
    expectPro: true,
    sleep: noSleep,
  });
  assert.equal(late.outcome, 'confirmed');
  assert.equal(attempts, 2);

  attempts = 0;
  const never = await syncPurchase({ sync: async () => (attempts += 1, notPro), expectPro: true, sleep: noSleep });
  assert.equal(never.outcome, 'retry');
  assert.equal(attempts, 3);

  attempts = 0;
  const restore = await syncPurchase({ sync: async () => (attempts += 1, notPro), expectPro: false, sleep: noSleep });
  assert.equal(restore.outcome, 'none');
  assert.equal(attempts, 1);
});

test('서버가 거절하면(이미 웹으로 이용 중 등) 다시 보내지 않는다', async () => {
  let attempts = 0;
  const result = await syncPurchase({
    sync: async () => {
      attempts += 1;
      throw apiError(409, 'already_subscribed');
    },
    expectPro: true,
    sleep: noSleep,
  });
  assert.equal(result.outcome, 'rejected');
  assert.equal(result.code, 'already_subscribed');
  assert.equal(attempts, 1);
});

test('재시도 판정과 사용자 문구', () => {
  assert.equal(retryable(apiError(500)), true);
  assert.equal(retryable(apiError(429)), true);
  assert.equal(retryable(new Error('offline')), true);
  assert.equal(retryable(apiError(409, 'x')), false);
  assert.equal(confirmMessage({ outcome: 'confirmed' }), null);
  assert.match(confirmMessage({ outcome: 'rejected', code: 'already_subscribed' }), /이미 Pro/);
  assert.match(confirmMessage({ outcome: 'pending' }), /아직 끝나지 않았어요/);
  assert.match(confirmMessage({ outcome: 'retry' }), /다시 열면 자동으로/);
  assert.match(confirmMessage({ outcome: 'none' }), /복원할 구독이 없어요/);
  assert.match(confirmMessage({ outcome: 'rejected', code: 'billing_unavailable' }), /확인하지 못했어요/);
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
