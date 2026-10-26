import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { NavBackButton, NavHeader } from '@/components/app-header';
import { ProBadge, ProBenefitRow } from '@/components/pro-ui';
import { palette } from '@/constants/palette';
import { openStoreSubscriptions } from '@/hooks/use-store-purchase';
import { api } from '@/lib/api';
import { billingClosed, managedNote, planLine, planTitle, type BillingMe } from '@/lib/billing';
import { translate as t } from '@/lib/i18n';

/**
 * ⑥ 설정 · ACTTUB Pro 구독 관리(pen GmTw6, SOMA-818). 지금 플랜 상자(PRO · Pro 이용 중 · 다음 결제일·금액·카드) · 혜택 세 줄 · 어디서
 * 결제한 구독인지 한 줄(웹이면 「웹에서 결제한 구독이에요」, 링크 없음). 결제 수단 변경·해지 버튼은 앱에 두지 않는다 — 결제는
 * 결제한 곳에서 관리한다.
 */
export default function ProManageScreen() {
  const router = useRouter();
  const [me, setMe] = useState<BillingMe | null>(null);

  const load = useCallback(() => {
    void api
      .billingMe()
      .then(setMe)
      .catch((e) => {
        if (billingClosed(e)) router.back();
      });
  }, [router]);
  useFocusEffect(load);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <NavHeader title={t('pro.manageTitle')} left={<NavBackButton onPress={() => router.back()} />} />
      {!me ? (
        <Text style={styles.loading}>{t('pro.loadingPlan')}</Text>
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
              <ProBenefitRow title={t('pro.rowModel')} sub={t('pro.proModel')} />
              <ProBenefitRow title={t('pro.rowHabit')} sub={t('pro.proHabit')} />
              <ProBenefitRow title={t('pro.rowNote')} sub={t('pro.proNote')} />
              <ProBenefitRow title={t('pro.rowPron')} sub={t('pro.managePron')} />
            </View>
            {managedNote(me) && <Text style={styles.note}>{managedNote(me)}</Text>}
            {(me.provider === 'apple' || me.provider === 'google') && (
              <Pressable onPress={() => void openStoreSubscriptions().catch(() => undefined)} accessibilityRole="link" hitSlop={8}>
                <Text style={styles.manageLink}>{t('pro.manageStore')}</Text>
              </Pressable>
            )}
          </ScrollView>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  loading: { marginTop: 80, textAlign: 'center', fontSize: 14, color: palette.textFaint },
  manageLink: { fontSize: 14, fontWeight: '700', color: palette.blue, paddingHorizontal: 4, paddingVertical: 6 },
  body: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 24, gap: 18 },
  plan: { backgroundColor: palette.blueSoft, borderRadius: 18, padding: 18, gap: 8 },
  planWarn: { backgroundColor: palette.dangerSoft },
  planRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  planTitle: { fontSize: 17, fontWeight: '800', color: palette.text },
  planLine: { fontSize: 14, color: palette.textStrong, lineHeight: 20 },
  benefits: { paddingHorizontal: 4 },
  note: { fontSize: 13, color: palette.textFaint, lineHeight: 19, paddingHorizontal: 4 },
});
