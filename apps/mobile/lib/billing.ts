/**
 * 앱 ACTTUB Pro 정기결제(SOMA-818, specs/billing/subscription) — 서버 /v2/billing 의 모양과 화면이 쓰는 순수 규칙.
 *
 * 결제는 앱 스토어 결제가 아니라 토스페이먼츠 자동결제다. 앱은 서버가 준 일회용 카드 등록 창 주소를 브라우저 인증
 * 세션으로 열고, 앱 스킴(actingapp://billing-result)으로 돌아오면 서버 상태를 다시 읽어 결과를 가른다. 주소에 실린
 * status 는 참고만 한다 — 결제가 됐는지는 언제나 서버의 /v2/billing/me 가 정한다.
 */
import { errorCode, errorStatus } from './api-request.ts';
import { translate as t } from './i18n.ts';

export type BillingStatus = 'none' | 'active' | 'canceled' | 'past_due' | 'expired';

export type BillingMe = {
  status: BillingStatus;
  pro: boolean;
  amount: number;
  period_end: string | null;
  next_billing_at: string | null;
  card_company: string | null;
  card_last4: string | null;
  retry_count: number;
  limits_enforced: boolean;
};

export type BillingPurpose = 'subscribe' | 'change_card';

export type BillingCheckout = { checkout_url: string; return_url: string; expires_at: string };

export const BILLING_RETURN_URL = 'actingapp://billing-result';
export const PRICING_URL = 'https://acttub.com/pricing';
export const TERMS_URL = 'https://acttub.com/terms';
export const REFUND_URL = 'https://acttub.com/refund';

/** 서버가 결제 기능을 닫아 두었는가(404 billing_unavailable). 닫혀 있으면 앱은 Pro 진입점을 숨긴다. */
export function billingClosed(error: unknown): boolean {
  return errorStatus(error) === 404 || errorCode(error) === 'billing_unavailable';
}

export type ReturnStatus = 'done' | 'failed' | 'unknown' | 'canceled' | 'invalid';

/** 브라우저가 돌아온 주소의 status. 앱 스킴이 아니거나 값이 모르는 것이면 null. */
export function returnStatusOf(url: string | null | undefined, returnUrl: string = BILLING_RETURN_URL): ReturnStatus | null {
  if (!url || !url.startsWith(returnUrl)) return null;
  const query = url.slice(returnUrl.length).replace(/^[/]?\?/, '');
  for (const part of query.split('&')) {
    const [key, value] = part.split('=');
    if (key === 'status' && (['done', 'failed', 'unknown', 'canceled', 'invalid'] as const).includes(value as ReturnStatus)) {
      return value as ReturnStatus;
    }
  }
  return null;
}

/** 결제 창을 닫고 돌아온 뒤 어느 화면으로 갈지. done=결제 완료, failed=결제하지 못했어요, checking=결과 확인 중, stay=그대로. */
export type CheckoutOutcome = 'done' | 'failed' | 'checking' | 'stay';

/**
 * 서버 상태(after)로 가른다. 브라우저를 그냥 닫았거나 사용자가 토스 창에서 취소했으면 stay 다.
 * 첫 결제: Pro 가 됐으면 done. 결과를 모르면(unknown) checking — 서버가 같은 주문으로 다시 확인한다.
 * 카드 바꾸기: 돌아온 status 가 done 이고 자동결제 실패 상태가 아니면 done.
 */
export function checkoutOutcome(purpose: BillingPurpose, returned: ReturnStatus | null, after: BillingMe | null): CheckoutOutcome {
  if (purpose === 'subscribe' && after?.pro && after.status === 'active') return 'done';
  if (returned === null || returned === 'canceled' || returned === 'invalid') return 'stay';
  if (returned === 'unknown') return 'checking';
  if (purpose === 'change_card') return returned === 'done' && after?.status !== 'past_due' ? 'done' : 'failed';
  return 'failed';
}

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 「11월 23일」 — 한국 시간 날짜. 비면 null. */
export function monthDay(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const at = new Date(Date.parse(iso) + KST_OFFSET_MS);
  if (Number.isNaN(at.getTime())) return null;
  return t('pro.monthDay', { month: at.getUTCMonth() + 1, day: at.getUTCDate() });
}

/** 「신한카드 ····1234」. 카드사 이름에 「카드」가 없으면 붙인다. */
export function cardLabel(company: string | null | undefined, last4: string | null | undefined): string | null {
  if (!company && !last4) return null;
  const name = company ? (company.endsWith('카드') ? company : company + t('pro.cardSuffix')) : t('pro.card');
  return last4 ? `${name} ····${last4}` : name;
}

/** 3,900 → 「3,900원」. */
export function won(amount: number): string {
  return t('pro.won', { amount: amount.toLocaleString('en-US') });
}

/** 구독 관리 위 상자의 둘째 줄(pen GmTw6 「다음 결제 11월 23일 · 3,900원 · 신한카드 ····1234」). */
export function planLine(me: BillingMe): string {
  const card = cardLabel(me.card_company, me.card_last4);
  switch (me.status) {
    case 'active':
      return [t('pro.nextBilling', { date: monthDay(me.next_billing_at) ?? '' }), won(me.amount), card].filter(Boolean).join(' · ');
    case 'canceled':
      return t('pro.canceledLine', { date: monthDay(me.period_end) ?? '' });
    case 'past_due':
      return t('pro.pastDueLine', { date: monthDay(me.next_billing_at) ?? '' });
    default:
      return t('pro.freeLine');
  }
}

/** 구독 관리 위 상자의 제목. */
export function planTitle(me: BillingMe): string {
  if (me.status === 'past_due') return t('pro.pastDueTitle');
  return me.pro ? t('pro.using') : t('pro.free');
}

/** 설정 「ACTTUB Pro」 줄의 아래 글. */
export function settingsSub(me: BillingMe): string {
  if (me.status === 'past_due') return t('pro.settingsPastDue');
  return me.pro ? t('pro.settingsPro') : t('pro.settingsFree');
}

/** 설정 줄을 누르면 갈 곳 — 구독이 있으면 구독 관리, 없으면 Pro 안내. */
export function settingsTarget(me: BillingMe): '/pro-manage' | '/pro' {
  return me.status === 'none' || me.status === 'expired' ? '/pro' : '/pro-manage';
}

/** 서버의 무료 한도 오류 → 띄울 시트. 플래그가 꺼져 있으면 서버가 이 코드를 보내지 않아 시트도 뜨지 않는다. */
export type FreeLimit = 'coaching' | 'script';

export function freeLimitOf(error: unknown): FreeLimit | null {
  const code = errorCode(error);
  if (code === 'free_daily_coaching_limit') return 'coaching';
  if (code === 'free_script_limit') return 'script';
  return null;
}

/** iOS 는 결제 창 전에 외부 결제 안내를 앱 화면으로 띄운다(hD5to). */
export function needsExternalNotice(os: string): boolean {
  return os === 'ios';
}
