import assert from 'node:assert/strict';
import test from 'node:test';

import {
  billingClosed,
  managedNote,
  proVisible,
  purchaseOpen,
  cardLabel,
  freeLimitOf,
  monthDay,
  planLine,
  planTitle,
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

test('billing: 날짜·카드·금액 표시', () => {
  assert.equal(monthDay('2026-11-22T16:00:00Z'), '11월 23일');
  assert.equal(monthDay(null), null);
  assert.equal(monthDay('nope'), null);
  assert.equal(cardLabel('신한', '1234'), '신한카드 ····1234');
  assert.equal(cardLabel('현대카드', null), '현대카드');
  assert.equal(cardLabel(null, null), null);
  assert.equal(won(3900), '3,900원');
});

test('billing: 구독 관리 상자 글', () => {
  assert.equal(planLine(me()), '다음 결제 11월 23일 · 3,900원 · 신한카드 ····1234');
  assert.equal(planLine(me({ status: 'canceled', next_billing_at: null })), '11월 23일까지 Pro · 자동결제 해지됨');
  assert.match(planLine(me({ status: 'past_due', pro: false, next_billing_at: '2026-11-24T01:00:00Z' })), /11월 24일/);
  assert.equal(planLine(me({ status: 'none', pro: false })), '지금은 무료로 쓰고 있어요');
  assert.equal(planTitle(me()), 'Pro 이용 중');
  assert.equal(planTitle(me({ status: 'past_due', pro: false })), '결제하지 못했어요');
  assert.equal(planTitle(me({ status: 'expired', pro: false })), '무료 이용 중');
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

test('billing: 결제한 곳만 한 줄로 알리고 링크·웹 결제 안내는 없다', () => {
  assert.equal(managedNote(me({ provider: 'toss' })), '웹에서 결제한 구독이에요');
  assert.equal(managedNote(me({ provider: 'apple' })), '스토어에서 결제한 구독이에요');
  assert.equal(managedNote(me({ provider: null })), null);
  assert.doesNotMatch(String(managedNote(me({ provider: 'toss' }))), /acttub\.com|pricing|http/);
  assert.equal(planLine(me({ status: 'none', pro: true, grant_ends_at: '2026-11-30T14:59:00Z' })), '11월 30일까지 Pro 이용 기간이에요');
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
