import * as WebBrowser from 'expo-web-browser';
import { useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { api } from '@/lib/api';
import {
  checkoutOutcome,
  needsExternalNotice,
  PRICING_URL,
  returnStatusOf,
  type BillingMe,
  type BillingPurpose,
  type CheckoutOutcome,
} from '@/lib/billing';
import { errorCode } from '@/lib/api-request';
import { translate as t } from '@/lib/i18n';

/**
 * Pro 결제 창 열기(SOMA-818). 서버가 준 일회용 토스 카드 등록 창을 브라우저 인증 세션으로 열고, 앱 스킴으로 돌아오면
 * 서버 상태를 다시 읽어 결제 완료(kqeG6)·결제하지 못했어요(ETD1H)로 보낸다. iOS 는 먼저 외부 결제 안내(hD5to)를 띄운다.
 *
 * @param onSettled 결과가 나온 뒤(바뀐 상태로) 부른다 — 구독 관리가 카드 바꾸기 뒤 화면을 다시 그린다.
 */
export function useProCheckout(onSettled?: (outcome: CheckoutOutcome, after: BillingMe | null) => void) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<BillingPurpose | null>(null);
  const lock = useRef(false);

  const run = useCallback(
    async (purpose: BillingPurpose) => {
      if (lock.current) return;
      lock.current = true;
      setBusy(true);
      setError(null);
      try {
        const checkout = await api.billingCheckout(purpose);
        const result = await WebBrowser.openAuthSessionAsync(checkout.checkout_url, checkout.return_url);
        const returned = result.type === 'success' ? returnStatusOf(result.url, checkout.return_url) : null;
        const after = await api.billingMe().catch(() => null);
        const outcome = checkoutOutcome(purpose, returned, after);
        if (outcome === 'done' && purpose === 'subscribe') router.replace('/pro-done');
        else if (outcome === 'failed') router.push({ pathname: '/pro-failed', params: { purpose } });
        else if (outcome === 'checking') router.push({ pathname: '/pro-failed', params: { purpose, checking: '1' } });
        onSettled?.(outcome, after);
      } catch (e) {
        // 그사이 다른 기기에서 구독했다 — 구독 관리로 보낸다.
        if (errorCode(e) === 'already_subscribed') router.replace('/pro-manage');
        else setError(t('pro.openFailed'));
      } finally {
        lock.current = false;
        setBusy(false);
      }
    },
    [router, onSettled],
  );

  const begin = useCallback(
    (purpose: BillingPurpose) => {
      if (needsExternalNotice(Platform.OS)) setNotice(purpose);
      else void run(purpose);
    },
    [run],
  );

  return {
    begin,
    busy,
    error,
    noticeVisible: notice !== null,
    cancelNotice: () => setNotice(null),
    continueNotice: () => {
      const purpose = notice;
      setNotice(null);
      if (purpose) void run(purpose);
    },
    learnMore: () => void WebBrowser.openBrowserAsync(PRICING_URL),
  };
}
