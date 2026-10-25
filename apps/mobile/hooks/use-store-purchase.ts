/**
 * 앱 안의 Pro 구매(App Store·Play 스토어 구독, SOMA-818 2단계) — expo-iap 로 스토어 결제를 열고, 결과를 서버에 확인받는다.
 * 앱 안에서 웹 결제로 보내는 경로는 두지 않는다(Apple 규정). 결제가 됐는지는 언제나 서버(/v2/billing/store/verify)가 정한다.
 *
 * - 구매자 연결: iOS appAccountToken · Android obfuscatedAccountId 에 우리 user id 를 넣는다(서버가 요청 사용자와 같은지 확인).
 * - 순서: 스토어 결제 → 서버 검증(재시도) → 서버 OK 후에만 거래 종료(iOS). Android 승인은 서버가 한다.
 * - 구매 복원: 이 계정으로 살 수 있었던 구독을 스토어에서 다시 읽어 서버에 확인받는다.
 * - 구독 관리: 스토어의 구독 관리 화면으로 보낸다.
 */
import * as Application from 'expo-application';
import * as IAP from 'expo-iap';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Platform } from 'react-native';

import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { translate as t } from '@/lib/i18n';
import {
  ANDROID_PACKAGE,
  confirmMessage,
  confirmPurchase,
  isProPurchase,
  pickOfferToken,
  STORE_PRODUCT_ID,
  type ConfirmResult,
  type StorePlatform,
  type StorePurchaseRecord,
} from '@/lib/store-billing';
import type { BillingMe } from '@/lib/billing';

export type StorePurchase = {
  /** 이 기기에서 스토어 구매를 시작할 수 있는가(상품과 가격을 불러왔다). */
  available: boolean;
  /** 스토어가 알려 준 현지화 가격(예: ₩3,900). 불러오기 전에는 null. */
  price: string | null;
  busy: boolean;
  /** 진행 중일 때 보일 짧은 상태 문구. */
  status: string | null;
  error: string | null;
  begin: () => void;
  restore: () => void;
  manage: () => void;
};

export function storePlatform(): StorePlatform | null {
  return Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : null;
}

/** 스토어 SDK 의 구매를 서버 확인에 맞는 값으로 바꾸고 확인받는다. */
export function confirmStorePurchase(platform: StorePlatform, purchase: IAP.Purchase): Promise<ConfirmResult> {
  return confirmPurchase(purchase as StorePurchaseRecord, {
    platform,
    verify: (body) => api.verifyStorePurchase(body),
    finish: (p) => IAP.finishTransaction({ purchase: p as IAP.Purchase, isConsumable: false }),
  });
}

/** 스토어의 구독 관리 화면 — iOS 는 시스템 구독 관리, Android 는 Play 스토어 내 구독(상품·패키지 지정). */
export async function openStoreSubscriptions(): Promise<void> {
  try {
    await IAP.deepLinkToSubscriptions({
      skuAndroid: STORE_PRODUCT_ID,
      packageNameAndroid: Application.applicationId ?? ANDROID_PACKAGE,
    });
  } catch {
    const url =
      Platform.OS === 'android'
        ? `https://play.google.com/store/account/subscriptions?sku=${STORE_PRODUCT_ID}&package=${Application.applicationId ?? ANDROID_PACKAGE}`
        : 'https://apps.apple.com/account/subscriptions';
    await Linking.openURL(url);
  }
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
  const [price, setPrice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const offerToken = useRef<string | null>(null);
  const confirmed = useRef(onConfirmed);
  confirmed.current = onConfirmed;
  const inFlight = useRef(new Set<string>());

  const settle = useCallback((result: ConfirmResult) => {
    setBusy(false);
    setStatus(null);
    const message = confirmMessage(result);
    setError(message);
    if (result.outcome === 'confirmed' && result.me) confirmed.current(result.me);
  }, []);

  const handlePurchase = useCallback(
    async (purchase: IAP.Purchase) => {
      if (!platform || !isProPurchase(purchase)) return;
      const key = purchase.id || purchase.purchaseToken || '';
      if (inFlight.current.has(key)) return;
      inFlight.current.add(key);
      setBusy(true);
      setStatus(t('pro.confirming'));
      try {
        settle(await confirmStorePurchase(platform, purchase));
      } finally {
        inFlight.current.delete(key);
      }
    },
    [platform, settle],
  );

  useEffect(() => {
    if (!enabled || !platform || !userId) return undefined;
    let alive = true;
    const updated = IAP.purchaseUpdatedListener((purchase) => void handlePurchase(purchase));
    const failed = IAP.purchaseErrorListener((e) => {
      setBusy(false);
      setStatus(null);
      setError(e.code === IAP.ErrorCode.UserCancelled ? null : t('pro.errStore'));
    });
    (async () => {
      try {
        await IAP.initConnection();
        const products = await IAP.fetchProducts({ skus: [STORE_PRODUCT_ID], type: 'subs' });
        const product = (products ?? []).find((p) => p.id === STORE_PRODUCT_ID);
        if (!alive || !product) return;
        offerToken.current = pickOfferToken((product as { subscriptionOffers?: IAP.SubscriptionOffer[] | null }).subscriptionOffers);
        setPrice(product.displayPrice);
      } catch {
        if (alive) setError(t('pro.errStore'));
      }
    })();
    return () => {
      alive = false;
      updated.remove();
      failed.remove();
      void IAP.endConnection();
    };
  }, [enabled, platform, userId, handlePurchase]);

  const begin = useCallback(() => {
    if (!enabled || !platform || !userId || busy) return;
    setBusy(true);
    setError(null);
    setStatus(t('pro.opening'));
    const sku = STORE_PRODUCT_ID;
    void IAP.requestPurchase({
      type: 'subs',
      request: {
        apple: { sku, appAccountToken: userId },
        google: {
          skus: [sku],
          obfuscatedAccountId: userId,
          subscriptionOffers: offerToken.current ? [{ sku, offerToken: offerToken.current }] : undefined,
        },
      },
    }).catch(() => {
      // 취소·실패는 purchaseErrorListener 가 정리한다. 리스너가 못 받은 예외만 여기서 닫는다.
      setBusy(false);
      setStatus(null);
    });
  }, [enabled, platform, userId, busy]);

  const restore = useCallback(() => {
    if (!enabled || !platform || busy) return;
    setBusy(true);
    setError(null);
    setStatus(t('pro.restoring'));
    void (async () => {
      try {
        const owned = (await IAP.getAvailablePurchases()).filter(isProPurchase);
        if (owned.length === 0) {
          setBusy(false);
          setStatus(null);
          setError(t('pro.restoreNone'));
          return;
        }
        let last: ConfirmResult = { outcome: 'rejected' };
        for (const purchase of owned) {
          last = await confirmStorePurchase(platform, purchase);
          if (last.outcome === 'confirmed') break;
        }
        settle(last);
      } catch {
        setBusy(false);
        setStatus(null);
        setError(t('pro.errStore'));
      }
    })();
  }, [enabled, platform, busy, settle]);

  const manage = useCallback(() => {
    void openStoreSubscriptions().catch(() => setError(t('pro.errStore')));
  }, []);

  return { available: enabled && price !== null && !!platform, price, busy, status, error, begin, restore, manage };
}
