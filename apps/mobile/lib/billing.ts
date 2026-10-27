/**
 * ACTTUB Pro 구독(SOMA-818, specs/billing/subscription) — 서버 /v2/billing 의 모양과 화면이 쓰는 순수 규칙.
 *
 * 앱 안의 구매는 App Store·Play 스토어 구독(2단계)이 맡는다. 웹(acttub.com)에서 토스페이먼츠로 결제한 구독은 앱이 상태만
 * 읽어 보여 주고, 앱 안에서 웹 결제로 보내는 버튼·링크·문구는 두지 않는다(Apple 규정). 결제가 됐는지는 언제나 서버의
 * /v2/billing/me 가 정한다.
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
  /** 결제 출처 — toss(웹)·apple·google(스토어). 구독이 없으면 null. */
  provider?: 'toss' | 'apple' | 'google' | null;
  /** 서버가 카드 없이 준 Pro 기간의 끝. */
  grant_ends_at?: string | null;
  /** 앱의 Pro 화면·구매 진입을 여는 서버 스위치(BILLING_APP_ENABLED). */
  app_enabled?: boolean;
  /** 창립 멤버 남은 자리(0~100)와 내 번호(SOMA-861). 옛 서버는 두 값을 주지 않는다. */
  founding_remaining?: number;
  founding_number?: number | null;
};

export const TERMS_URL = 'https://acttub.com/terms';
export const REFUND_URL = 'https://acttub.com/refund';

/** 서버가 결제 기능을 닫아 두었는가(404 billing_unavailable). 닫혀 있으면 앱은 Pro 진입점을 숨긴다. */
export function billingClosed(error: unknown): boolean {
  return errorStatus(error) === 404 || errorCode(error) === 'billing_unavailable';
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
    case 'none':
      return me.pro && me.grant_ends_at ? t('pro.grantLine', { date: monthDay(me.grant_ends_at) ?? '' }) : t('pro.freeLine');
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

/**
 * 설정에 「ACTTUB Pro」 줄을 보이는가. 서버가 앱 Pro 화면을 열어 두었거나(app_enabled), 이미 Pro 인 사람(웹 결제·기간 부여)이면 본다.
 * 둘 다 아니면 구매 진입이 없다.
 */
export function proVisible(me: BillingMe): boolean {
  return me.app_enabled === true || me.pro;
}

/** 앱 안에서 구매를 시작할 수 있는 자리가 열려 있는가(스토어 결제 2단계가 붙는 자리). */
export function purchaseOpen(me: BillingMe | null): boolean {
  return me?.app_enabled === true && !me.pro;
}

/** 설정 줄을 누르면 갈 곳 — Pro 이거나 구독이 있으면 구독 관리, 없으면 Pro 안내. */
export function settingsTarget(me: BillingMe): '/pro-manage' | '/pro' {
  return me.pro || (me.status !== 'none' && me.status !== 'expired') ? '/pro-manage' : '/pro';
}

/**
 * App Store·Google Play 구독이 아직 돌고 있는가(자동 갱신이 켜져 있거나 결제 재시도 중). 탈퇴해도 스토어 구독은 해지되지 않으므로
 * 탈퇴 화면이 이 사람에게 스토어 구독 관리 링크를 보인다. 이미 해지했으면(canceled) 더 결제되지 않아 링크가 필요 없다.
 */
export function storeSubscribed(me: BillingMe | null | undefined): boolean {
  if (!me || (me.provider !== 'apple' && me.provider !== 'google')) return false;
  return me.status === 'active' || me.status === 'past_due';
}

/** 구독 관리 아래 안내 — 어디서 결제한 구독인지만 말한다(링크 없음). */
export function managedNote(me: BillingMe): string | null {
  if (me.provider === 'toss') return t('pro.webManaged');
  if (me.provider === 'apple' || me.provider === 'google') return t('pro.storeManaged');
  return null;
}

/** 서버의 무료 한도 오류 → 띄울 시트. 플래그가 꺼져 있으면 서버가 이 코드를 보내지 않아 시트도 뜨지 않는다. */
export type FreeLimit = 'coaching' | 'script';

export function freeLimitOf(error: unknown): FreeLimit | null {
  const code = errorCode(error);
  if (code === 'free_daily_coaching_limit') return 'coaching';
  if (code === 'free_script_limit') return 'script';
  return null;
}

/** 결제 화면 맨 위 「창립 멤버 n/100 남음」의 n. 남은 자리가 없거나 값이 없으면 null(줄을 숨긴다). */
export function foundingRemaining(me: BillingMe | null): number | null {
  const left = me?.founding_remaining;
  return typeof left === 'number' && Number.isFinite(left) && left > 0 ? Math.min(100, Math.floor(left)) : null;
}

/** 이름 옆 「창립 멤버」 배지를 그릴 번호인가 — 1~100 정수만. */
export function isFoundingNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 100;
}
