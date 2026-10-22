import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { NavBackButton, NavHeader } from '@/components/app-header';
import { ExternalPurchaseNotice } from '@/components/pro-ui';
import { MASCOT } from '@/components/ui/mascot';
import { StatusScreen } from '@/components/ui/status-screen';
import { palette } from '@/constants/palette';
import { useProCheckout } from '@/hooks/use-pro-checkout';
import { api } from '@/lib/api';
import type { BillingPurpose } from '@/lib/billing';
import { translate as t } from '@/lib/i18n';

/**
 * ⑥ Pro · 결제하지 못했어요(pen ETD1H, SOMA-818). 첫 결제가 거절됐거나, 자동결제가 실패했거나(past_due), 결과를 아직 모를 때
 * (`checking=1`) 연다. [다시 시도]: 자동결제 실패면 서버가 같은 시도를 두 번 결제하지 않고 지금 다시 결제하고, 첫 결제면 카드
 * 등록 창을 다시 연다. 결과를 모를 때는 서버 상태만 다시 읽는다.
 */
export default function ProFailedScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ purpose?: string; checking?: string }>();
  const purpose: BillingPurpose = params.purpose === 'change_card' ? 'change_card' : 'subscribe';
  const [checking, setChecking] = useState(params.checking === '1');
  const [busy, setBusy] = useState(false);
  const checkout = useProCheckout();
  const leave = () => (router.canGoBack() ? router.back() : router.replace('/settings'));

  const retry = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const me = await api.billingMe();
      if (me.pro && me.status === 'active') return router.replace('/pro-done');
      if (me.status === 'past_due') {
        const after = await api.billingRetry();
        if (after.pro) return router.replace('/pro-done');
        setChecking(false);
        return;
      }
      if (checking) return; // 아직 결과를 모른다 — 그대로 둔다.
      checkout.begin(purpose);
    } catch {
      // 연결이 끊겼다. 화면을 그대로 두고 다시 누르게 한다(같은 시도는 두 번 결제되지 않는다).
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <NavHeader title={t('pro.manageTitle')} left={<NavBackButton onPress={leave} />} />
      <StatusScreen
        mascot={MASCOT.dizzy}
        title={checking ? t('pro.checkingTitle') : t('pro.failedTitle')}
        body={checking ? t('pro.checkingBody') : t('pro.failedBody')}
        primary={{ label: checking ? t('pro.checkAgain') : t('pro.retry'), onPress: () => void retry(), loading: busy || checkout.busy }}
        secondary={{ label: t('pro.later'), onPress: leave }}
      />
      <ExternalPurchaseNotice
        visible={checkout.noticeVisible}
        onCancel={checkout.cancelNotice}
        onContinue={checkout.continueNotice}
        onLearnMore={checkout.learnMore}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: palette.bg } });
