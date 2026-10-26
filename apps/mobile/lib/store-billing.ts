/**
 * 앱 스토어 구독(App Store·Play 스토어, SOMA-818 2단계)의 순수 규칙. 스토어 SDK(expo-iap)는 hooks/use-store-purchase 가 부르고,
 * 이 파일은 SDK 없이 값만 다룬다 — 구매 영수증을 서버 검증 요청으로 바꾸고, 서버가 OK 한 뒤에만 거래를 끝내는 순서를 정한다.
 *
 * 순서가 핵심이다: 결제가 됐는데 Pro 가 안 켜지는 일이 없도록 ① 서버 검증(네트워크 오류는 재시도) ② 서버 OK 일 때만 거래 종료.
 * 서버가 영영 못 받으면 거래를 끝내지 않고 남겨 두어 앱을 다시 열 때 다시 검증한다. Google 은 승인(acknowledge)을 서버가 하므로
 * 앱은 Android 거래를 끝내지 않는다.
 */
import { errorCode, errorStatus } from './api-request.ts';
import type { BillingMe } from './billing.ts';
import { translate as t } from './i18n.ts';

/** 양 스토어 공통 상품 ID. 구글은 구독 ID, 기본 요금제(base plan) ID 는 monthly. */
export const STORE_PRODUCT_ID = 'acttub_pro_monthly';
export const GOOGLE_BASE_PLAN_ID = 'monthly';
/** 연 구독(약 30% 할인, 앱 스토어 전용). 구글 기본 요금제 ID 는 yearly. */
export const STORE_PRODUCT_YEARLY_ID = 'acttub_pro_yearly';
export const GOOGLE_BASE_PLAN_YEARLY_ID = 'yearly';

export type StorePlan = 'monthly' | 'yearly';
export const STORE_PLANS: readonly StorePlan[] = ['monthly', 'yearly'];
export const STORE_PRODUCT_IDS: readonly string[] = [STORE_PRODUCT_ID, STORE_PRODUCT_YEARLY_ID];

export function planProductId(plan: StorePlan): string {
  return plan === 'yearly' ? STORE_PRODUCT_YEARLY_ID : STORE_PRODUCT_ID;
}

export function planBasePlanId(plan: StorePlan): string {
  return plan === 'yearly' ? GOOGLE_BASE_PLAN_YEARLY_ID : GOOGLE_BASE_PLAN_ID;
}

/** 상품 ID → 요금제. 우리 상품이 아니면 null. */
export function productPlan(productId: string | null | undefined): StorePlan | null {
  if (productId === STORE_PRODUCT_ID) return 'monthly';
  if (productId === STORE_PRODUCT_YEARLY_ID) return 'yearly';
  return null;
}
export const ANDROID_PACKAGE = 'com.acttub.app';

export type StorePlatform = 'ios' | 'android';

/** 스토어 SDK 의 구매 중 우리가 읽는 값. iOS 의 purchaseToken 은 거래 JWS, Android 는 구매 토큰이다. */
export type StorePurchaseRecord = {
  productId: string;
  purchaseToken?: string | null;
};

export type VerifyBody =
  | { platform: 'ios'; product_id: string; signed_transaction: string }
  | { platform: 'android'; product_id: string; purchase_token: string };

export function isProPurchase(purchase: StorePurchaseRecord | null | undefined): boolean {
  return productPlan(purchase?.productId) !== null;
}

/** 서버 검증 요청 본문. 영수증(토큰)이 비어 있으면 null — 검증할 수 없다. */
export function verifyBody(platform: StorePlatform, purchase: StorePurchaseRecord): VerifyBody | null {
  const token = purchase.purchaseToken?.trim();
  if (!token) return null;
  const productId = productPlan(purchase.productId) ? purchase.productId : STORE_PRODUCT_ID;
  return platform === 'ios'
    ? { platform, product_id: productId, signed_transaction: token }
    : { platform, product_id: productId, purchase_token: token };
}

export type OfferLike = {
  id?: string | null;
  basePlanIdAndroid?: string | null;
  offerTokenAndroid?: string | null;
};

/** Android 구독을 살 때 넣는 오퍼 토큰 — 기본 요금제(월 monthly·연 yearly)의 할인 없는 오퍼. 없으면 null. */
export function pickOfferToken(offers: readonly OfferLike[] | null | undefined, basePlanId: string = GOOGLE_BASE_PLAN_ID): string | null {
  const plan = (offers ?? []).filter((o) => o.basePlanIdAndroid === basePlanId && o.offerTokenAndroid);
  const base = plan.find((o) => !o.id || o.id === basePlanId);
  return (base ?? plan[0])?.offerTokenAndroid ?? null;
}

export type ConfirmOutcome = 'confirmed' | 'retry' | 'pending' | 'rejected';

export type ConfirmResult = { outcome: ConfirmOutcome; me?: BillingMe; code?: string | null };

export type ConfirmDeps = {
  platform: StorePlatform;
  verify: (body: VerifyBody) => Promise<BillingMe>;
  /** 서버가 OK 한 뒤에만 부른다. Android 는 서버가 승인하므로 호출하지 않는다. */
  finish: (purchase: StorePurchaseRecord) => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
};

const RETRY_DELAYS_MS = [800, 2500];

/** 다시 시도할 만한 실패인가 — 연결 실패·서버 오류·요청 제한. 4xx 거절은 다시 보내도 같다. */
export function retryable(error: unknown): boolean {
  const status = errorStatus(error);
  return status === null || status >= 500 || status === 429;
}

/**
 * 구매 하나를 서버에 확인받는다. 서버 OK 면 거래를 끝내고 confirmed. 네트워크·서버 오류는 몇 번 다시 시도한 뒤 retry(거래는 남겨
 * 앱을 다시 열 때 재검증). 결제 대기(409 payment_pending)는 pending, 그 밖의 거절(다른 계정·이미 구독 중·영수증 불량)은 rejected —
 * 거래를 끝내지 않는다(Google 은 3일 안에 승인되지 않으면 자동 환불된다).
 */
export async function confirmPurchase(purchase: StorePurchaseRecord, deps: ConfirmDeps): Promise<ConfirmResult> {
  const body = verifyBody(deps.platform, purchase);
  if (!body) return { outcome: 'rejected', code: 'invalid_store_receipt' };
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 0; ; attempt += 1) {
    try {
      const me = await deps.verify(body);
      if (deps.platform === 'ios') await deps.finish(purchase);
      return { outcome: 'confirmed', me };
    } catch (error) {
      const code = errorCode(error);
      if (code === 'payment_pending') return { outcome: 'pending', code };
      if (!retryable(error)) return { outcome: 'rejected', code };
      if (attempt >= RETRY_DELAYS_MS.length) return { outcome: 'retry', code };
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }
}

/** 확인되지 않은 결과를 사용자에게 보일 한 줄. confirmed 면 null. */
export function confirmMessage(result: ConfirmResult): string | null {
  if (result.outcome === 'confirmed') return null;
  if (result.outcome === 'pending') return t('pro.errPending');
  if (result.outcome === 'retry') return t('pro.errRetry');
  switch (result.code) {
    case 'store_account_mismatch':
    case 'store_account_conflict':
      return t('pro.errAccount');
    case 'already_subscribed':
      return t('pro.errAlready');
    default:
      return t('pro.errGeneric');
  }
}

/**
 * 시작할 때 미완료 거래를 다시 확인할 필요가 있는가. 서버가 앱 결제를 열어 두었고 아직 Pro 가 아닐 때만 — 이미 Pro 면 고칠 것이
 * 없고(갱신·만료는 스토어 알림이 반영한다), 닫혀 있으면 스토어 SDK 를 건드리지 않는다.
 */
export function needsRecovery(me: BillingMe | null | undefined): boolean {
  return me?.app_enabled === true && !me.pro;
}

/** 두 번 연속 돌지 않도록 최소 간격. */
export const RECOVERY_MIN_INTERVAL_MS = 30_000;

export function recoveryDue(lastRunAt: number | null, now: number): boolean {
  return lastRunAt === null || now - lastRunAt >= RECOVERY_MIN_INTERVAL_MS;
}
