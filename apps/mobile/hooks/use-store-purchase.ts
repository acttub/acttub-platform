/**
 * 앱 안의 Pro 구매(App Store·Play 스토어 구독, SOMA-818 2단계) — RevenueCat SDK 로 스토어 결제를 열고, 끝나면 서버에 동기화를
 * 부탁한다(POST /v2/billing/store/sync, 재시도). Pro 인지는 언제나 서버 응답이 정한다. 앱 안에서 웹 결제로 보내는 경로는 두지
 * 않는다(Apple 규정).
 *
 * - 구매자 연결: RevenueCat app user id = 우리 user id(lib/revenuecat identify).
 * - 상품: RevenueCat current offering 의 월($rc_monthly)·연($rc_annual) 패키지. 오퍼링에 없는 요금제는 고를 수 없다.
 * - 구매 복원: RevenueCat restorePurchases 뒤 서버 동기화.
 * - 구독 관리: 스토어의 구독 관리 화면으로 보낸다.
 */
import * as Application from 'expo-application';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Platform } from 'react-native';
import type { PurchasesPackage } from 'react-native-purchases';

import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { translate as t } from '@/lib/i18n';
import { identify, Purchases, revenueCatAvailable, storePlatform } from '@/lib/revenuecat';
import {
  ANDROID_PACKAGE,
  confirmMessage,
  planPackage,
  planPrices,
  purchaseCancelled,
  purchasePending,
  STORE_PLANS,
  syncPurchase,
  type ConfirmResult,
  type StorePlan,
} from '@/lib/store-billing';
import type { BillingMe } from '@/lib/billing';

export { storePlatform };

export type StorePurchase = {
  /** 이 기기에서 스토어 구매를 시작할 수 있는가(오퍼링과 가격을 불러왔다). */
  available: boolean;
  /** 스토어가 알려 준 월 구독 현지화 가격(예: ₩3,900). 불러오기 전에는 null. */
  price: string | null;
  /** 요금제별 현지화 가격(월·연). 오퍼링에 없거나 불러오기 전이면 null. */
  prices: Record<StorePlan, string | null>;
  busy: boolean;
  /** 진행 중일 때 보일 짧은 상태 문구. */
  status: string | null;
  error: string | null;
  /** 고른 요금제로 스토어 결제를 연다(기본 월). */
  begin: (plan?: StorePlan) => void;
  restore: () => void;
  manage: () => void;
};

/** 서버에 RevenueCat 상태를 다시 읽어 달라고 한다(재시도 포함). */
export function syncStore(expectPro: boolean): Promise<ConfirmResult> {
  return syncPurchase({ sync: () => api.syncStorePurchases(), expectPro });
}

/**
 * 스토어의 구독 관리 화면 — iOS 는 App Store 구독 관리, Android 는 Play 스토어 정기 결제. Android 는 상품(월·연)을 알 때만 그 구독
 * 상세로 바로 가고, 모르면 이 앱의 정기 결제 목록을 연다(어느 요금제를 샀는지 앱이 모를 수 있다).
 */
export async function openStoreSubscriptions(productId?: string): Promise<void> {
  const packageName = Application.applicationId ?? ANDROID_PACKAGE;
  if (Platform.OS === 'android') {
    await Linking.openURL(
      productId
        ? `https://play.google.com/store/account/subscriptions?sku=${productId}&package=${packageName}`
        : `https://play.google.com/store/account/subscriptions?package=${packageName}`,
    );
    return;
  }
  await Linking.openURL('https://apps.apple.com/account/subscriptions');
}

type Options = {
  /** 켜져 있을 때만 스토어에 연결한다(서버가 앱 결제를 열었고 아직 Pro 가 아닐 때). */
  enabled: boolean;
  /** 서버가 Pro 를 확인했을 때. */
  onConfirmed: (me: BillingMe) => void;
};

export function useStorePurchase({ enabled, onConfirmed }: Options): StorePurchase {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const platform = storePlatform();
  const ready = enabled && !!platform && !!userId && revenueCatAvailable();
  const [prices, setPrices] = useState<Record<StorePlan, string | null>>({ monthly: null, yearly: null });
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const packages = useRef<Record<StorePlan, PurchasesPackage | null>>({ monthly: null, yearly: null });
  const confirmed = useRef(onConfirmed);
  confirmed.current = onConfirmed;
  const running = useRef(false);

  const settle = useCallback((result: ConfirmResult) => {
    running.current = false;
    setBusy(false);
    setStatus(null);
    setError(confirmMessage(result));
    if (result.outcome === 'confirmed' && result.me) confirmed.current(result.me);
  }, []);

  const fail = useCallback((message: string | null) => {
    running.current = false;
    setBusy(false);
    setStatus(null);
    setError(message);
  }, []);

  useEffect(() => {
    if (!ready || !userId) return undefined;
    let alive = true;
    (async () => {
      try {
        await identify(userId);
        const offering = (await Purchases.getOfferings()).current;
        if (!alive) return;
        for (const plan of STORE_PLANS) packages.current[plan] = planPackage(offering, plan);
        setPrices(planPrices(offering));
      } catch {
        if (alive) setError(t('pro.errStore'));
      }
    })();
    return () => {
      alive = false;
    };
  }, [ready, userId]);

  const begin = useCallback(
    (plan: StorePlan = 'monthly') => {
      const pkg = packages.current[plan];
      if (!ready || !userId || running.current || !pkg) return;
      running.current = true;
      setBusy(true);
      setError(null);
      setStatus(t('pro.opening'));
      void (async () => {
        try {
          await identify(userId);
          await Purchases.purchasePackage(pkg);
        } catch (e) {
          if (purchaseCancelled(e)) fail(null);
          else if (purchasePending(e)) fail(t('pro.errPending'));
          else fail(t('pro.errStore'));
          return;
        }
        setStatus(t('pro.confirming'));
        settle(await syncStore(true));
      })();
    },
    [ready, userId, settle, fail],
  );

  const restore = useCallback(() => {
    if (!ready || !userId || running.current) return;
    running.current = true;
    setBusy(true);
    setError(null);
    setStatus(t('pro.restoring'));
    void (async () => {
      try {
        await identify(userId);
        await Purchases.restorePurchases();
      } catch {
        fail(t('pro.errStore'));
        return;
      }
      settle(await syncStore(false));
    })();
  }, [ready, userId, settle, fail]);

  const manage = useCallback(() => {
    void openStoreSubscriptions().catch(() => setError(t('pro.errStore')));
  }, []);

  const available = ready && (prices.monthly !== null || prices.yearly !== null);
  return { available, price: prices.monthly, prices, busy, status, error, begin, restore, manage };
}
