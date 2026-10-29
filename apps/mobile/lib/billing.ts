/**
 * ACTTUB Pro 구독(SOMA-818, specs/billing/subscription) — 서버 /v2/billing 의 모양과 화면이 쓰는 순수 규칙.
 *
 * 앱 안의 구매는 App Store·Play 스토어 구독(2단계)이 맡는다. 웹(acttub.com)에서 토스페이먼츠로 결제한 구독은 앱이 상태만
 * 읽어 보여 주고, 앱 안에서 웹 결제로 보내는 버튼·링크·문구는 두지 않는다(Apple 규정). 결제가 됐는지는 언제나 서버의
 * /v2/billing/me 가 정한다.
 */
import { errorCode, errorStatus } from './api-request.ts';
import { translate as t } from './i18n.ts';
import type { StorePlan } from './store-billing.ts';

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
export const PRIVACY_URL = 'https://acttub.com/privacy';

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

/** 3,900 → 「3,900원」. */
export function won(amount: number): string {
  return t('pro.won', { amount: amount.toLocaleString('en-US') });
}

/** 설정 「ACTTUB Pro」 줄의 아래 글. */
export function settingsSub(me: BillingMe): string {
  if (me.status === 'past_due') return t('pro.settingsPastDue');
  if (me.status === 'canceled' && me.pro) return t('pro.settingsCanceled', { date: monthDay(me.period_end) ?? '' });
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
 * 스토어(App Store·Play) 구독 줄이 아직 살아 있는가(active·canceled·past_due). 이 줄은 서버가 RevenueCat 을 다시 읽어야 해지·만료가
 * 반영되므로, 화면에 들어올 때 서버 동기화를 한 번 부탁한다(SOMA-851).
 */
export function storeLive(me: BillingMe | null | undefined): boolean {
  if (!me || (me.provider !== 'apple' && me.provider !== 'google')) return false;
  return me.status === 'active' || me.status === 'canceled' || me.status === 'past_due';
}

/** 스토어 동기화를 두 번 연속 보내지 않는 최소 간격. */
export const BILLING_SYNC_MIN_INTERVAL_MS = 30_000;

/**
 * 구독 상태를 새로 받는다. 스토어 구독이 살아 있으면 서버에 RevenueCat 을 다시 읽어 달라고 한 결과(해지 예약·만료 반영)를 쓰고,
 * 동기화가 실패하거나 간격 안이면 방금 받은 /me 를 쓴다. 오래된 값을 돌려주지 않는다.
 */
export async function loadBilling(deps: {
  me: () => Promise<BillingMe>;
  sync: () => Promise<BillingMe>;
  syncAllowed: boolean;
}): Promise<{ me: BillingMe; synced: boolean }> {
  const me = await deps.me();
  if (!deps.syncAllowed || !storeLive(me)) return { me, synced: false };
  try {
    return { me: await deps.sync(), synced: true };
  } catch {
    return { me, synced: false };
  }
}

/**
 * App Store·Google Play 구독이 아직 돌고 있는가(자동 갱신이 켜져 있거나 결제 재시도 중). 탈퇴해도 스토어 구독은 해지되지 않으므로
 * 탈퇴 화면이 이 사람에게 스토어 구독 관리 링크를 보인다. 이미 해지했으면(canceled) 더 결제되지 않아 링크가 필요 없다.
 */
export function storeSubscribed(me: BillingMe | null | undefined): boolean {
  if (!me || (me.provider !== 'apple' && me.provider !== 'google')) return false;
  return me.status === 'active' || me.status === 'past_due';
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

/** Pro 안내에 들어온 곳(라우트 `from`). 들어온 곳마다 위 안내·제목·혜택 세 줄이 다르다. */
export type ProFrom = 'default' | 'coaching' | 'script' | 'pron';

const PRO_FROM: readonly ProFrom[] = ['coaching', 'script', 'pron'];

export function proFrom(raw: unknown): ProFrom {
  return PRO_FROM.find((from) => from === raw) ?? 'default';
}

/** Pro 안내 화면의 상태. 서버 구독 상태(me)와 스토어 구매 훅의 값에서만 정해진다. */
export type PaywallState =
  | { kind: 'loading_me' }
  | { kind: 'already_pro' }
  | { kind: 'closed' }
  | { kind: 'prices_loading' }
  | { kind: 'prices_failed' }
  | { kind: 'ready' }
  | { kind: 'busy'; label: string }
  | { kind: 'failed'; message: string };

export function paywallState(
  me: BillingMe | null,
  purchase: { busy: boolean; status: string | null; error: string | null; prices: Record<StorePlan, string | null> },
): PaywallState {
  if (!me) return { kind: 'loading_me' };
  if (me.pro) return { kind: 'already_pro' };
  if (!purchaseOpen(me)) return { kind: 'closed' };
  if (purchase.busy) return { kind: 'busy', label: purchase.status ?? '' };
  // 훅은 가격을 다 받았는지 알려 주지 않는다. 가격 없이 오류만 있으면 불러오기가 실패한 것이다.
  const priced = purchase.prices.monthly !== null || purchase.prices.yearly !== null;
  if (!priced) return purchase.error ? { kind: 'prices_failed' } : { kind: 'prices_loading' };
  return purchase.error ? { kind: 'failed', message: purchase.error } : { kind: 'ready' };
}

/** 구독 관리 위 상자의 바탕 톤. */
export type ManageTone = 'free' | 'pro' | 'canceled' | 'problem' | 'grant';

/** 구독 관리 목록 줄. store 는 이 기기 스토어의 구독 관리 화면을 연다. */
export type ManageRow = { kind: 'store' | 'refund' | 'restore'; label: string };

/** 구독 관리 아래 고정 버튼. explore 는 Pro 안내, store 는 스토어 구독 관리. */
export type ManageCta = { kind: 'explore' | 'store'; label: string };

export type ManageView = {
  tone: ManageTone;
  /** 제목 위 작은 글. 있으면 PRO 배지 대신 보인다. */
  eyebrow: string | null;
  badge: boolean;
  title: string;
  meta: string;
  rows: ManageRow[];
  cta: ManageCta | null;
};

export type StoreOs = 'ios' | 'android';

type StoreProvider = 'apple' | 'google';

const STORE_OF_OS: Record<StoreOs, StoreProvider> = { ios: 'apple', android: 'google' };

/** 스토어마다 다른 문구 키. 이름은 「~에서 산 구독」, 줄·안내는 그 스토어 앱 이름이다. */
const STORE_COPY: Record<StoreProvider, { name: string; manage: string; resubscribe: string; fixPayment: string }> = {
  apple: { name: 'pro.storeApple', manage: 'pro.manageApple', resubscribe: 'pro.resubscribeApple', fixPayment: 'pro.fixPaymentApple' },
  google: { name: 'pro.storeGoogle', manage: 'pro.manageGoogle', resubscribe: 'pro.resubscribeGoogle', fixPayment: 'pro.fixPaymentGoogle' },
};

function planName(me: BillingMe): string {
  return me.amount === 32_500 ? t('pro.planYearly') : t('pro.planMonthly');
}

/** 「월 구독 · 3,900원」. */
export function planSummary(me: BillingMe): string {
  return t('pro.planSummary', { plan: planName(me), price: won(me.amount) });
}

/**
 * 구독 관리 화면이 그릴 것. 구독의 상태·출처와 이 기기 스토어로 정한다. 웹(토스) 구독은 상태만 말하고 웹으로 가는 줄은 두지
 * 않는다. 구매 복원은 서버가 앱 결제를 열어 둔 때만 줄로 보인다(닫혀 있으면 스토어에 연결하지 않는다).
 */
export function manageView(me: BillingMe, os: StoreOs): ManageView {
  const refund: ManageRow = { kind: 'refund', label: t('pro.refund') };
  const tail: ManageRow[] = me.app_enabled === true ? [refund, { kind: 'restore', label: t('pro.restore') }] : [refund];
  const explore: ManageCta = { kind: 'explore', label: t('pro.explore') };
  const base = { eyebrow: null, badge: false, cta: null };

  if (me.status === 'none' || me.status === 'expired') {
    if (me.pro && me.grant_ends_at) {
      const date = monthDay(me.grant_ends_at) ?? '';
      return { ...base, tone: 'grant', eyebrow: t('pro.grantEyebrow'), title: t('pro.until', { date }), meta: t('pro.grantMeta'), rows: tail, cta: explore };
    }
    return { ...base, tone: 'free', eyebrow: t('pro.freeEyebrow'), title: t('pro.free'), meta: t('pro.freeMeta'), rows: tail, cta: explore };
  }

  if (me.provider !== 'apple' && me.provider !== 'google') {
    const meta =
      me.status === 'active'
        ? t('pro.webMeta', { plan: planName(me), date: monthDay(me.next_billing_at) ?? '' })
        : me.status === 'canceled'
          ? t('pro.untilPro', { date: monthDay(me.period_end) ?? '' })
          : t('pro.pastDueTitle');
    return { ...base, tone: me.status === 'past_due' ? 'problem' : 'pro', badge: me.pro, title: t('pro.webManaged'), meta, rows: [refund] };
  }

  const copy = STORE_COPY[me.provider];
  const here = me.provider === STORE_OF_OS[os];
  if (me.status === 'past_due') {
    return {
      ...base,
      tone: 'problem',
      eyebrow: planName(me),
      title: t('pro.pastDueTitle'),
      meta: t(copy.fixPayment),
      rows: tail,
      cta: here ? { kind: 'store', label: t('pro.fixPaymentCta') } : null,
    };
  }
  if (!here) {
    const name = t(copy.name);
    return { ...base, tone: 'pro', badge: me.pro, title: t('pro.otherStoreTitle', { store: name }), meta: t('pro.otherStoreMeta', { store: name }), rows: tail };
  }
  if (me.status === 'canceled') {
    return {
      ...base,
      tone: 'canceled',
      eyebrow: t('pro.canceledEyebrow'),
      title: t('pro.untilPro', { date: monthDay(me.period_end) ?? '' }),
      meta: t('pro.canceledMeta'),
      rows: [{ kind: 'store', label: t(copy.resubscribe) }, ...tail],
    };
  }
  return {
    ...base,
    tone: 'pro',
    badge: true,
    title: planSummary(me),
    meta: t('pro.nextBilling', { date: monthDay(me.next_billing_at) ?? '' }),
    rows: [{ kind: 'store', label: t(copy.manage) }, ...tail],
  };
}

/** 결제 완료 화면의 요약 줄(요금제 · 다음 결제). 서버가 값을 주지 않은 줄은 뺀다. */
export function doneSummary(me: BillingMe | null): { label: string; value: string }[] {
  if (!me?.pro) return [];
  const next = monthDay(me.next_billing_at);
  return [
    me.amount > 0 ? { label: t('pro.summaryPlan'), value: planSummary(me) } : null,
    next ? { label: t('pro.summaryNext'), value: next } : null,
  ].filter((row) => row !== null);
}
