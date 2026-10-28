/**
 * 설정·구독 관리 화면이 쓰는 구독 상태(SOMA-851). 화면에 들어올 때와 앱이 앞으로 돌아올 때마다 서버 상태를 새로 받고, 받는 동안은
 * loading 이 true 다 — 화면은 이전 값을 확정처럼 보이지 말고 짧은 상태 문구를 보인다. 스토어 구독이 살아 있으면 서버에 RevenueCat
 * 동기화를 함께 부탁해 해지 예약·만료가 바로 반영된다(30초 안에는 한 번만).
 */
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { api } from '@/lib/api';
import { BILLING_SYNC_MIN_INTERVAL_MS, loadBilling, type BillingMe } from '@/lib/billing';

export type BillingState = {
  /** 마지막으로 받은 값. loading 이 true 이면 아직 확정이 아니다. 결제 기능이 닫혀 있거나 실패하면 null. */
  me: BillingMe | null;
  loading: boolean;
  /** 마지막 요청이 실패했는가(404 포함). */
  error: unknown;
};

export function useBillingMe(): BillingState {
  const [state, setState] = useState<BillingState>({ me: null, loading: true, error: null });
  const focused = useRef(false);
  const lastSync = useRef<number | null>(null);
  const seq = useRef(0);

  const refresh = useCallback(() => {
    const mine = (seq.current += 1);
    const now = Date.now();
    const syncAllowed = lastSync.current === null || now - lastSync.current >= BILLING_SYNC_MIN_INTERVAL_MS;
    setState((prev) => ({ ...prev, loading: true }));
    loadBilling({ me: () => api.billingMe(), sync: () => api.syncStorePurchases(), syncAllowed })
      .then(({ me, synced }) => {
        if (synced) lastSync.current = Date.now();
        if (seq.current === mine) setState({ me, loading: false, error: null });
      })
      .catch((error) => {
        if (seq.current === mine) setState({ me: null, loading: false, error });
      });
  }, []);

  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      refresh();
      return () => {
        focused.current = false;
      };
    }, [refresh]),
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active' && focused.current) refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  return state;
}
