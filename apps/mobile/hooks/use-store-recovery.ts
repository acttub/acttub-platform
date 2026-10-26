/**
 * 앱을 켜거나 앞으로 가져올 때, 결제는 됐는데 Pro 가 안 켜진 구매(서버 동기화 전에 앱이 꺼졌거나 네트워크가 끊긴 경우)를 찾아 서버에
 * 다시 동기화를 부탁한다(SOMA-818 2단계). 서버가 앱 결제를 열었고 아직 Pro 가 아닌 사람만 RevenueCat 을 읽는다 — 그 밖에는 SDK 를
 * 건드리지 않는다. RevenueCat 의 고객 정보에 활성 entitlement 가 있을 때만 서버를 부른다(헛걸음을 줄인다).
 *
 * 로그아웃하면 RevenueCat 에서도 이 사람을 뺀다(다음 사람이 앞사람 구독을 쓰지 않게).
 */
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { syncStore } from '@/hooks/use-store-purchase';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { forget, identify, Purchases, revenueCatAvailable, storePlatform } from '@/lib/revenuecat';
import { needsRecovery, recoveryDue } from '@/lib/store-billing';

/** RevenueCat entitlement ID(서버 REVENUECAT_ENTITLEMENT_ID 기본값과 같다). */
export const ENTITLEMENT_ID = 'pro';

export function useStoreRecovery(active: boolean): void {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const lastRun = useRef<number | null>(null);
  const running = useRef(false);

  useEffect(() => {
    if (!userId) void forget();
  }, [userId]);

  useEffect(() => {
    if (!active || !userId || !storePlatform() || !revenueCatAvailable()) return undefined;
    const run = async () => {
      const now = Date.now();
      if (running.current || !recoveryDue(lastRun.current, now)) return;
      running.current = true;
      lastRun.current = now;
      try {
        const me = await api.billingMe().catch(() => null);
        if (!needsRecovery(me)) return;
        await identify(userId);
        const info = await Purchases.getCustomerInfo();
        if (!info.entitlements.active[ENTITLEMENT_ID]) return;
        await syncStore(false);
      } catch {
        // 다음에 앱을 켜거나 앞으로 가져올 때 다시 본다.
      } finally {
        running.current = false;
      }
    };
    void run();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void run();
    });
    return () => subscription.remove();
  }, [active, userId]);
}
