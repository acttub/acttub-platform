/**
 * 앱을 켜거나 앞으로 가져올 때, 결제는 됐는데 Pro 가 안 켜진 구매(서버 확인 전에 앱이 꺼졌거나 네트워크가 끊긴 경우)를 찾아 다시
 * 서버에 확인받는다(SOMA-818 2단계). 서버가 앱 결제를 열었고 아직 Pro 가 아닌 사람만 스토어를 읽는다 — 그 밖에는 SDK 를 건드리지 않는다.
 */
import * as IAP from 'expo-iap';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { confirmStorePurchase, storePlatform } from '@/hooks/use-store-purchase';
import { api } from '@/lib/api';
import { isProPurchase, needsRecovery, recoveryDue } from '@/lib/store-billing';

export function useStoreRecovery(active: boolean): void {
  const lastRun = useRef<number | null>(null);
  const running = useRef(false);

  useEffect(() => {
    const platform = storePlatform();
    if (!active || !platform) return undefined;
    const run = async () => {
      const now = Date.now();
      if (running.current || !recoveryDue(lastRun.current, now)) return;
      running.current = true;
      lastRun.current = now;
      try {
        const me = await api.billingMe().catch(() => null);
        if (!needsRecovery(me)) return;
        await IAP.initConnection();
        const owned = (await IAP.getAvailablePurchases()).filter(isProPurchase);
        for (const purchase of owned) {
          const result = await confirmStorePurchase(platform, purchase);
          if (result.outcome === 'confirmed') break;
        }
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
  }, [active]);
}
