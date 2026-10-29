import assert from 'node:assert/strict';
import test from 'node:test';

import {
  billingClosed,
  storeSubscribed,
  proVisible,
  purchaseOpen,
  freeLimitOf,
  monthDay,
  settingsSub,
  settingsTarget,
  won,
} from '../lib/billing.ts';
import { startFailure } from '../lib/practice/start.ts';

const me = (over = {}) => ({
  status: 'active',
  pro: true,
  amount: 3900,
  period_end: '2026-11-23T01:00:00Z',
  next_billing_at: '2026-11-23T01:00:00Z',
  card_company: '신한',
  card_last4: '1234',
  retry_count: 0,
  limits_enforced: false,
  ...over,
});

test('billing: 404 billing_unavailable 이면 결제 기능이 닫힌 것으로 본다', () => {
  assert.equal(billingClosed({ status: 404, code: 'billing_unavailable' }), true);
  assert.equal(billingClosed({ status: 500, code: 'internal' }), false);
});

test('billing: 날짜·금액 표시', () => {
  assert.equal(monthDay('2026-11-22T16:00:00Z'), '11월 23일');
  assert.equal(monthDay(null), null);
  assert.equal(monthDay('nope'), null);
  assert.equal(won(3900), '3,900원');
});

test('billing: 설정 줄 — 구독이 있으면 구독 관리, 없으면 Pro 안내', () => {
  assert.equal(settingsSub(me({ status: 'none', pro: false })), '무료 이용 중 · Pro 알아보기');
  assert.equal(settingsSub(me()), 'Pro 이용 중');
  assert.match(settingsSub(me({ status: 'past_due', pro: false })), /결제하지 못했어요/);
  assert.equal(settingsTarget(me({ status: 'none', pro: false })), '/pro');
  assert.equal(settingsTarget(me({ status: 'expired', pro: false })), '/pro');
  assert.equal(settingsTarget(me({ status: 'canceled' })), '/pro-manage');
  assert.equal(settingsTarget(me({ status: 'none', pro: true, grant_ends_at: '2026-12-01T00:00:00Z' })), '/pro-manage');
});

test('billing: 구매 진입은 서버가 앱 스위치를 켰을 때만 — 웹에서 결제한 사람은 상태만 본다', () => {
  assert.equal(proVisible(me({ status: 'none', pro: false })), false);
  assert.equal(proVisible(me({ status: 'none', pro: false, app_enabled: true })), true);
  assert.equal(proVisible(me({ provider: 'toss' })), true);
  assert.equal(purchaseOpen(me({ status: 'none', pro: false })), false);
  assert.equal(purchaseOpen(me({ status: 'none', pro: false, app_enabled: true })), true);
  assert.equal(purchaseOpen(me({ app_enabled: true })), false);
  assert.equal(purchaseOpen(null), false);
});

test('billing: 탈퇴 화면의 스토어 링크는 스토어 구독이 돌고 있을 때만(SOMA-818)', () => {
  assert.equal(storeSubscribed(me({ provider: 'google', status: 'active' })), true);
  assert.equal(storeSubscribed(me({ provider: 'apple', status: 'past_due' })), true);
  assert.equal(storeSubscribed(me({ provider: 'apple', status: 'canceled' })), false);
  assert.equal(storeSubscribed(me({ provider: 'google', status: 'expired' })), false);
  assert.equal(storeSubscribed(me({ provider: 'toss', status: 'active' })), false);
  assert.equal(storeSubscribed(me({ provider: null, status: 'none' })), false);
  assert.equal(storeSubscribed(null), false);
});

test('billing: 무료 한도 오류 → 시트', () => {
  assert.equal(freeLimitOf({ code: 'free_daily_coaching_limit' }), 'coaching');
  assert.equal(freeLimitOf({ code: 'free_script_limit' }), 'script');
  assert.equal(freeLimitOf({ code: 'guest_daily_analysis_limit' }), null);
});

test('billing: 코칭 시작이 무료 한도에 걸리면 free_limit — 게스트 하루 한도와 가른다', () => {
  assert.deepEqual(startFailure({ status: 429, code: 'free_daily_coaching_limit' }), { kind: 'free_limit' });
  assert.deepEqual(startFailure({ status: 429, code: 'guest_daily_analysis_limit' }), { kind: 'daily_limit' });
});

test('창립 멤버(SOMA-861) — 남은 자리가 1 이상일 때만 줄 숫자를 주고, 0·없음·잘못된 값은 숨긴다', async () => {
  const { foundingRemaining, isFoundingNumber } = await import('../lib/billing.ts');
  assert.equal(foundingRemaining(null), null);
  assert.equal(foundingRemaining(me({})), null);
  assert.equal(foundingRemaining(me({ founding_remaining: 0 })), null);
  assert.equal(foundingRemaining(me({ founding_remaining: -3 })), null);
  assert.equal(foundingRemaining(me({ founding_remaining: Number.NaN })), null);
  assert.equal(foundingRemaining(me({ founding_remaining: 37 })), 37);
  assert.equal(foundingRemaining(me({ founding_remaining: 250 })), 100);
  assert.equal(isFoundingNumber(1), true);
  assert.equal(isFoundingNumber(100), true);
  assert.equal(isFoundingNumber(0), false);
  assert.equal(isFoundingNumber(101), false);
  assert.equal(isFoundingNumber(null), false);
  assert.equal(isFoundingNumber(3.5), false);
});

test('해지 예약한 스토어 구독은 설정에 「해지 예정」으로 보인다(SOMA-851)', async () => {
  const { settingsSub, storeLive, loadBilling } = await import('../lib/billing.ts');
  const canceled = me({ status: 'canceled', pro: true, provider: 'google', period_end: '2026-11-23T03:00:00Z' });
  assert.equal(settingsSub(canceled), '11월 23일까지 이용 · 해지 예정');
  assert.equal(storeLive(canceled), true);
  assert.equal(storeLive(me({ provider: 'toss' })), false);
  assert.equal(storeLive(me({ provider: 'google', status: 'expired', pro: false })), false);
  assert.equal(storeLive(null), false);
  void loadBilling;
});

test('loadBilling: 스토어 구독이면 동기화 결과를 쓰고, 실패하거나 간격 안이면 방금 받은 값을 쓴다', async () => {
  const { loadBilling } = await import('../lib/billing.ts');
  const stale = me({ status: 'active', pro: true, provider: 'google' });
  const fresh = me({ status: 'expired', pro: false, provider: 'google' });
  const ok = await loadBilling({ me: async () => stale, sync: async () => fresh, syncAllowed: true });
  assert.deepEqual([ok.me.status, ok.synced], ['expired', true]);
  const failed = await loadBilling({ me: async () => stale, sync: async () => { throw new Error('x'); }, syncAllowed: true });
  assert.deepEqual([failed.me.status, failed.synced], ['active', false]);
  let called = false;
  const throttled = await loadBilling({ me: async () => stale, sync: async () => { called = true; return fresh; }, syncAllowed: false });
  assert.equal(called, false);
  assert.equal(throttled.me.status, 'active');
  const toss = await loadBilling({ me: async () => me({ provider: 'toss' }), sync: async () => { called = true; return fresh; }, syncAllowed: true });
  assert.equal(called, false);
  assert.equal(toss.synced, false);
});

test('billing: Pro 안내에 들어온 곳은 아는 값만 받고 나머지는 기본이다', async () => {
  const { proFrom } = await import('../lib/billing.ts');
  assert.equal(proFrom('coaching'), 'coaching');
  assert.equal(proFrom('script'), 'script');
  assert.equal(proFrom('pron'), 'pron');
  assert.equal(proFrom(undefined), 'default');
  assert.equal(proFrom(['coaching']), 'default');
  assert.equal(proFrom('PRO'), 'default');
});

test('billing: Pro 안내 상태는 서버 구독과 스토어 구매 값에서 하나로 정해진다', async () => {
  const { paywallState } = await import('../lib/billing.ts');
  const open = me({ status: 'none', pro: false, app_enabled: true });
  const idle = { busy: false, status: null, error: null, prices: { monthly: null, yearly: null } };
  const priced = { ...idle, prices: { monthly: '₩3,900', yearly: null } };
  assert.deepEqual(paywallState(null, idle), { kind: 'loading_me' });
  assert.deepEqual(paywallState(me({ app_enabled: true }), priced), { kind: 'already_pro' });
  assert.deepEqual(paywallState(me({ status: 'none', pro: false, app_enabled: false }), priced), { kind: 'closed' });
  assert.deepEqual(paywallState(open, idle), { kind: 'prices_loading' });
  assert.deepEqual(paywallState(open, { ...idle, error: '스토어에 연결하지 못했어요.' }), { kind: 'prices_failed' });
  assert.deepEqual(paywallState(open, priced), { kind: 'ready' });
  assert.deepEqual(paywallState(open, { ...priced, busy: true, status: '결제창을 여는 중이에요' }), { kind: 'busy', label: '결제창을 여는 중이에요' });
  assert.deepEqual(paywallState(open, { ...priced, error: '결제를 확인하지 못했어요.' }), { kind: 'failed', message: '결제를 확인하지 못했어요.' });
});

test('billing: 구독 관리 — 무료·무료 Pro 기간은 요금제 상자와 환불·복원 줄, [Pro 알아보기]', async () => {
  const { manageView } = await import('../lib/billing.ts');
  const refund = { kind: 'refund', label: '환불 기준' };
  const restore = { kind: 'restore', label: '구매 복원' };
  const explore = { kind: 'explore', label: 'Pro 알아보기' };
  assert.deepEqual(manageView(me({ status: 'expired', pro: false, provider: null, app_enabled: true }), 'ios'), {
    tone: 'free', eyebrow: '지금 요금제', badge: false, title: '무료 이용 중', meta: '코칭 하루 3회 · 대본 3개 보관',
    rows: [refund, restore], cta: explore,
  });
  assert.deepEqual(manageView(me({ status: 'none', pro: true, provider: null, grant_ends_at: '2026-11-30T14:59:00Z', app_enabled: true }), 'ios'), {
    tone: 'grant', eyebrow: '무료 Pro', badge: false, title: '11월 30일까지', meta: '끝나도 자동 결제 없이 무료로 돌아가요',
    rows: [refund, restore], cta: explore,
  });
  // 앱 결제가 닫혀 있으면 복원 줄이 없다(스토어에 연결하지 않는다).
  assert.deepEqual(manageView(me({ status: 'none', pro: false, provider: null, app_enabled: false }), 'ios').rows, [refund]);
});

test('billing: 구독 관리 — 스토어 구독은 상태·기기 스토어에 따라 제목·줄·버튼이 바뀐다', async () => {
  const { manageView } = await import('../lib/billing.ts');
  const refund = { kind: 'refund', label: '환불 기준' };
  const restore = { kind: 'restore', label: '구매 복원' };
  const apple = (over) => me({ provider: 'apple', app_enabled: true, ...over });
  assert.deepEqual(manageView(apple({}), 'ios'), {
    tone: 'pro', eyebrow: null, badge: true, title: '월 구독 · 3,900원', meta: '다음 결제 11월 23일',
    rows: [{ kind: 'store', label: 'App Store에서 구독 관리' }, refund, restore], cta: null,
  });
  assert.deepEqual(manageView(me({ provider: 'google', amount: 32500, app_enabled: true }), 'android'), {
    tone: 'pro', eyebrow: null, badge: true, title: '연 구독 · 32,500원', meta: '다음 결제 11월 23일',
    rows: [{ kind: 'store', label: 'Play 스토어에서 구독 관리' }, refund, restore], cta: null,
  });
  assert.deepEqual(manageView(apple({ status: 'canceled' }), 'ios'), {
    tone: 'canceled', eyebrow: '자동 결제 해지됨', badge: false, title: '11월 23일까지 Pro', meta: '그 뒤에는 무료로 돌아가요',
    rows: [{ kind: 'store', label: 'App Store에서 다시 구독' }, refund, restore], cta: null,
  });
  assert.deepEqual(manageView(apple({ status: 'past_due', pro: false }), 'ios'), {
    tone: 'problem', eyebrow: '월 구독', badge: false, title: '결제하지 못했어요', meta: 'App Store에서 결제 수단을 확인해 주세요',
    rows: [refund, restore], cta: { kind: 'store', label: '결제 수단 확인하기' },
  });
  // 다른 스토어에서 산 구독은 이 기기에서 관리·결제 수단 확인을 열지 않는다.
  assert.deepEqual(manageView(me({ provider: 'google', status: 'past_due', pro: false, app_enabled: true }), 'ios').cta, null);
  assert.deepEqual(manageView(me({ provider: 'google', app_enabled: true }), 'ios'), {
    tone: 'pro', eyebrow: null, badge: true, title: 'Google Play에서 산 구독이에요', meta: '구독 관리는 그 기기의 Google Play에서 할 수 있어요',
    rows: [refund, restore], cta: null,
  });
});

test('billing: 구독 관리 — 웹(토스) 구독은 상태만 말하고 웹 결제로 가는 줄·버튼이 없다', async () => {
  const { manageView } = await import('../lib/billing.ts');
  const view = manageView(me({ provider: 'toss', app_enabled: true }), 'ios');
  assert.deepEqual(view, {
    tone: 'pro', eyebrow: null, badge: true, title: '웹에서 결제한 구독이에요', meta: '월 구독 · 다음 결제 11월 23일',
    rows: [{ kind: 'refund', label: '환불 기준' }], cta: null,
  });
  assert.doesNotMatch(JSON.stringify(view), /acttub\.com|pricing|http/);
});

test('billing: 결제 완료 요약은 요금제·다음 결제를 보이고 서버가 주지 않은 줄은 뺀다', async () => {
  const { doneSummary } = await import('../lib/billing.ts');
  assert.deepEqual(doneSummary(me({ provider: 'apple' })), [
    { label: '요금제', value: '월 구독 · 3,900원' },
    { label: '다음 결제', value: '11월 23일' },
  ]);
  assert.deepEqual(doneSummary(me({ provider: 'google', amount: 32500, next_billing_at: null })), [
    { label: '요금제', value: '연 구독 · 32,500원' },
  ]);
  assert.deepEqual(doneSummary(me({ status: 'none', pro: true, amount: 0, next_billing_at: null })), []);
  assert.deepEqual(doneSummary(null), []);
});
