import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { NavBackButton, NavHeader } from '@/components/app-header';
import { useAppDialog } from '@/components/app-dialog';
import { ExternalPurchaseNotice, ProBadge, ProBenefitRow } from '@/components/pro-ui';
import { PrimaryButton } from '@/components/ui/buttons';
import { CtaBar } from '@/components/ui/cta-bar';
import { palette } from '@/constants/palette';
import { useProCheckout } from '@/hooks/use-pro-checkout';
import { api } from '@/lib/api';
import { billingClosed, monthDay, planLine, planTitle, type BillingMe } from '@/lib/billing';
import { translate as t } from '@/lib/i18n';

/**
 * ⑥ 설정 · ACTTUB Pro 구독 관리(pen GmTw6, SOMA-818). 지금 플랜 상자(PRO · Pro 이용 중 · 다음 결제일·금액·카드) · 혜택 세 줄 ·
 * 해지 안내 · [결제 수단 바꾸기] · 빨간 「자동결제 해지」. 구매 복원은 없다(구독은 계정에 붙는다). 자동결제를 해지했으면
 * 해지 줄을 숨기고 기간 끝 날짜를 보인다.
 */
export default function ProManageScreen() {
  const router = useRouter();
  const { confirm, alert, dialog } = useAppDialog();
  const [me, setMe] = useState<BillingMe | null>(null);
  const [canceling, setCanceling] = useState(false);

  const load = useCallback(() => {
    void api
      .billingMe()
      .then(setMe)
      .catch((e) => {
        if (billingClosed(e)) router.back();
      });
  }, [router]);
  useFocusEffect(load);

  const checkout = useProCheckout((outcome, after) => {
    if (after) setMe(after);
    if (outcome === 'done') void alert({ title: t('pro.changeCard'), message: t('pro.cardChanged') });
  });

  const cancel = async () => {
    if (!me || canceling) return;
    const ok = await confirm({
      title: t('pro.cancelTitle'),
      message: t('pro.cancelBody', { date: monthDay(me.period_end) ?? '' }),
      confirmLabel: t('pro.cancelConfirm'),
      cancelLabel: t('pro.cancelKeep'),
      destructive: true,
    });
    if (!ok) return;
    setCanceling(true);
    try {
      setMe(await api.billingCancel());
    } catch {
      void alert({ title: t('pro.cancel'), message: t('errors.network') });
    } finally {
      setCanceling(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <NavHeader title={t('pro.manageTitle')} left={<NavBackButton onPress={() => router.back()} />} />
      {!me ? (
        <ActivityIndicator style={styles.loading} color={palette.blue} />
      ) : (
        <>
          <ScrollView contentContainerStyle={styles.body}>
            <View style={[styles.plan, me.status === 'past_due' && styles.planWarn]}>
              <View style={styles.planRow}>
                <ProBadge small />
                <Text style={styles.planTitle}>{planTitle(me)}</Text>
              </View>
              <Text style={styles.planLine}>{planLine(me)}</Text>
            </View>
            <View style={styles.benefits}>
              <ProBenefitRow title={t('pro.rowCoaching')} sub={t('pro.unlimited')} />
              <ProBenefitRow title={t('pro.rowScripts')} sub={t('pro.unlimited')} />
              <ProBenefitRow title={t('pro.rowPron')} sub={t('pro.managePron')} />
            </View>
            <Text style={styles.note}>{t('pro.manageNote')}</Text>
          </ScrollView>
          <CtaBar>
            {checkout.error && <Text style={styles.error}>{checkout.error}</Text>}
            {me.status !== 'expired' && me.status !== 'none' && (
              <PrimaryButton label={t('pro.changeCard')} onPress={() => checkout.begin('change_card')}
                loading={checkout.busy} disabled={checkout.busy} phLabel="pro_change_card" />
            )}
            {me.status === 'none' || me.status === 'expired' ? (
              <PrimaryButton label={t('pro.start')} onPress={() => router.replace('/pro')} phLabel="pro_start" />
            ) : null}
            {(me.status === 'active' || me.status === 'past_due') && (
              <Pressable style={styles.cancel} onPress={() => void cancel()} disabled={canceling} accessibilityRole="button"
                ph-label="pro_cancel">
                <Text style={styles.cancelText}>{t('pro.cancel')}</Text>
              </Pressable>
            )}
          </CtaBar>
        </>
      )}
      <ExternalPurchaseNotice
        visible={checkout.noticeVisible}
        onCancel={checkout.cancelNotice}
        onContinue={checkout.continueNotice}
        onLearnMore={checkout.learnMore}
      />
      {dialog}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  loading: { marginTop: 80 },
  body: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 24, gap: 18 },
  plan: { backgroundColor: palette.blueSoft, borderRadius: 18, padding: 18, gap: 8 },
  planWarn: { backgroundColor: palette.dangerSoft },
  planRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  planTitle: { fontSize: 17, fontWeight: '800', color: palette.text },
  planLine: { fontSize: 14, color: palette.textStrong, lineHeight: 20 },
  benefits: { paddingHorizontal: 4 },
  note: { fontSize: 13, color: palette.textFaint, lineHeight: 19, paddingHorizontal: 4 },
  error: { fontSize: 13, color: palette.danger, textAlign: 'center', marginBottom: 8 },
  cancel: { alignItems: 'center', paddingVertical: 14 },
  cancelText: { fontSize: 15, fontWeight: '600', color: palette.danger },
});
