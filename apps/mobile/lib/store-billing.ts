/**
 * 앱 스토어 구독(App Store·Play 스토어, SOMA-818 2단계)의 순수 규칙. 결제는 RevenueCat SDK(react-native-purchases)가 하고
 * (lib/revenuecat.ts, hooks/use-store-purchase), 이 파일은 SDK 없이 값만 다룬다 — 오퍼링에서 월·연 패키지를 고르고, 구매·복원 뒤
 * 서버 동기화(POST /v2/billing/store/sync)를 재시도하며 결과를 사용자 문구로 바꾼다.
 *
 * Pro 인지는 언제나 서버가 정한다. 앱은 구매가 끝나면 서버에 「RevenueCat 에서 다시 읽어 달라」고 부탁하고, 서버 응답의 pro 로만
 * 화면을 바꾼다. 서버가 못 받으면 앱을 다시 열 때(복구) 또는 RevenueCat 웹훅이 반영한다.
 */
import { errorCode, errorStatus } from './api-request.ts';
import type { BillingMe } from './billing.ts';
import { translate as t } from './i18n.ts';

/** 양 스토어 공통 상품 ID(장부·문구용). 앱은 상품 ID 대신 RevenueCat 오퍼링의 패키지로 산다. */
export const STORE_PRODUCT_ID = 'acttub_pro_monthly';
/** 연 구독(약 30% 할인, 앱 스토어 전용). */
export const STORE_PRODUCT_YEARLY_ID = 'acttub_pro_yearly';
export const ANDROID_PACKAGE = 'com.acttub.app';

export type StorePlan = 'monthly' | 'yearly';
export const STORE_PLANS: readonly StorePlan[] = ['monthly', 'yearly'];

/** RevenueCat 기본 패키지 식별자 — 월 $rc_monthly, 연 $rc_annual. */
export const PLAN_PACKAGE_ID: Record<StorePlan, string> = { monthly: '$rc_monthly', yearly: '$rc_annual' };

export type StorePlatform = 'ios' | 'android';

/** 상품 ID → 요금제. 우리 상품이 아니면 null. Google 의 `구독ID:요금제ID` 꼴도 받는다. */
export function productPlan(productId: string | null | undefined): StorePlan | null {
  const base = productId?.split(':')[0];
  if (base === STORE_PRODUCT_ID) return 'monthly';
  if (base === STORE_PRODUCT_YEARLY_ID) return 'yearly';
  return null;
}

/** RevenueCat 패키지 중 우리가 읽는 값. */
export type PackageLike = {
  identifier: string;
  product: { identifier: string; priceString: string };
};

/** RevenueCat 오퍼링 중 우리가 읽는 값. monthly·annual 은 SDK 가 채워 주는 바로가기다. */
export type OfferingLike = {
  monthly?: PackageLike | null;
  annual?: PackageLike | null;
  availablePackages?: readonly PackageLike[] | null;
};

/** 오퍼링에서 요금제의 패키지를 고른다. 바로가기가 없으면 식별자($rc_monthly·$rc_annual)로 찾는다. 없으면 null. */
export function planPackage<P extends PackageLike>(
  offering: { monthly?: P | null; annual?: P | null; availablePackages?: readonly P[] | null } | null | undefined,
  plan: StorePlan,
): P | null {
  if (!offering) return null;
  const shortcut = plan === 'yearly' ? offering.annual : offering.monthly;
  if (shortcut) return shortcut;
  return (offering.availablePackages ?? []).find((p) => p.identifier === PLAN_PACKAGE_ID[plan]) ?? null;
}

/** 요금제별 현지화 가격. 오퍼링에 없는 요금제는 null(고를 수 없다). */
export function planPrices(offering: OfferingLike | null | undefined): Record<StorePlan, string | null> {
  return {
    monthly: planPackage(offering, 'monthly')?.product.priceString ?? null,
    yearly: planPackage(offering, 'yearly')?.product.priceString ?? null,
  };
}

/** 플랫폼별 RevenueCat 공개 SDK 키. 비어 있으면 null — 그 빌드에서는 스토어 구매를 열지 않는다. */
export function revenueCatKey(platform: StorePlatform | null, keys: { ios?: string | null; android?: string | null }): string | null {
  const key = platform === 'ios' ? keys.ios : platform === 'android' ? keys.android : null;
  return key?.trim() ? key.trim() : null;
}

/** RevenueCat SDK 오류 코드(PURCHASES_ERROR_CODE). 값은 SDK 의 문자열 그대로다. */
export const RC_CANCELLED = '1';
export const RC_PAYMENT_PENDING = '20';

/** 사용자가 스토어 결제창을 닫았는가. */
export function purchaseCancelled(error: unknown): boolean {
  const e = error as { userCancelled?: boolean | null; code?: unknown } | null;
  return e?.userCancelled === true || String(e?.code ?? '') === RC_CANCELLED;
}

/** 스토어가 결제를 아직 끝내지 않았는가(느린 결제 수단·보호자 승인 대기). */
export function purchasePending(error: unknown): boolean {
  return String((error as { code?: unknown } | null)?.code ?? '') === RC_PAYMENT_PENDING;
}

export type ConfirmOutcome = 'confirmed' | 'none' | 'retry' | 'pending' | 'rejected';

export type ConfirmResult = { outcome: ConfirmOutcome; me?: BillingMe; code?: string | null };

export type SyncDeps = {
  /** POST /v2/billing/store/sync */
  sync: () => Promise<BillingMe>;
  /** 방금 결제가 끝났다 — 서버가 아직 Pro 가 아니라고 하면 잠깐 뒤 다시 묻는다(RevenueCat 반영 지연). 복원이면 false. */
  expectPro: boolean;
  sleep?: (ms: number) => Promise<void>;
};

const RETRY_DELAYS_MS = [800, 2500];

/** 다시 시도할 만한 실패인가 — 연결 실패·서버 오류·요청 제한. 4xx 거절은 다시 보내도 같다. */
export function retryable(error: unknown): boolean {
  const status = errorStatus(error);
  return status === null || status >= 500 || status === 429;
}

/**
 * 서버에 RevenueCat 상태를 다시 읽어 달라고 하고 결과를 가른다. 서버가 Pro 라고 하면 confirmed. 네트워크·서버 오류는 몇 번 다시
 * 시도한 뒤 retry(앱을 다시 열 때 복구가 다시 묻는다). 결제 직후인데 서버가 아직 Pro 가 아니라고 하면 같은 간격으로 다시 묻고, 끝내
 * 아니면 retry. 복원인데 Pro 가 아니면 none. 그 밖의 거절(이미 웹으로 이용 중 등)은 rejected.
 */
export async function syncPurchase(deps: SyncDeps): Promise<ConfirmResult> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 0; ; attempt += 1) {
    try {
      const me = await deps.sync();
      if (me.pro) return { outcome: 'confirmed', me };
      if (!deps.expectPro) return { outcome: 'none', me };
      if (attempt >= RETRY_DELAYS_MS.length) return { outcome: 'retry', me };
    } catch (error) {
      const code = errorCode(error);
      if (!retryable(error)) return { outcome: 'rejected', code };
      if (attempt >= RETRY_DELAYS_MS.length) return { outcome: 'retry', code };
    }
    await sleep(RETRY_DELAYS_MS[attempt]);
  }
}

/** 확인되지 않은 결과를 사용자에게 보일 한 줄. confirmed 면 null. */
export function confirmMessage(result: ConfirmResult): string | null {
  if (result.outcome === 'confirmed') return null;
  if (result.outcome === 'none') return t('pro.restoreNone');
  if (result.outcome === 'pending') return t('pro.errPending');
  if (result.outcome === 'retry') return t('pro.errRetry');
  return result.code === 'already_subscribed' ? t('pro.errAlready') : t('pro.errGeneric');
}

/**
 * 시작할 때 다시 확인할 필요가 있는가. 서버가 앱 결제를 열어 두었고 아직 Pro 가 아닐 때만 — 이미 Pro 면 고칠 것이 없고(갱신·만료는
 * RevenueCat 웹훅이 반영한다), 닫혀 있으면 스토어 SDK 를 건드리지 않는다.
 */
export function needsRecovery(me: BillingMe | null | undefined): boolean {
  return me?.app_enabled === true && !me.pro;
}

/** 두 번 연속 돌지 않도록 최소 간격. */
export const RECOVERY_MIN_INTERVAL_MS = 30_000;

export function recoveryDue(lastRunAt: number | null, now: number): boolean {
  return lastRunAt === null || now - lastRunAt >= RECOVERY_MIN_INTERVAL_MS;
}
