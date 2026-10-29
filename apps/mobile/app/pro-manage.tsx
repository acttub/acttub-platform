import Feather from '@expo/vector-icons/Feather';
import { Stack, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Fragment, useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { NavBackButton, NavHeader } from '@/components/app-header';
import { ProBadge } from '@/components/pro-ui';
import { PrimaryButton } from '@/components/ui/buttons';
import { CtaBar } from '@/components/ui/cta-bar';
import { SkeletonBlock, SkeletonGroup } from '@/components/ui/skeleton';
import { InlineErrorLine } from '@/components/ui/inline-error';
import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';
import { useBillingMe } from '@/hooks/use-billing-me';
import { useStorePurchase } from '@/hooks/use-store-purchase';
import { billingClosed, manageView, REFUND_URL, type BillingMe, type ManageTone } from '@/lib/billing';
import { translate as t } from '@/lib/i18n';

const TONE_BG: Record<ManageTone, string> = {
  free: palette.bgSoft,
  canceled: palette.bgSoft,
  pro: palette.blueSoft,
  grant: palette.blueSoft,
  problem: palette.dangerSoft,
};

const EYEBROW_COLOR: Record<ManageTone, string> = {
  free: palette.textMeta,
  canceled: palette.textMeta,
  pro: palette.textMeta,
  grant: palette.blueDeep,
  problem: palette.textSub,
};

/**
 * ⑥ 설정 · 구독 관리(SOMA-818). 위 상태 상자(요금제·기간) · 줄 목록(스토어 구독 관리·환불 기준·구매 복원) · 필요하면 아래 버튼 하나.
 * 무엇을 그릴지는 `manageView` 가 정한다. 결제 수단 변경·해지는 결제한 곳(스토어)에서 하고, 웹에서 결제한 구독은 상태만 보인다.
 */
export default function ProManageScreen() {
  const router = useRouter();
  const { me: loaded, loading, error } = useBillingMe();
  // 구매 복원으로 서버가 돌려준 값. 다음에 새로 받으면 그 값을 쓴다.
  const [restored, setRestored] = useState<BillingMe | null>(null);
  useEffect(() => setRestored(null), [loaded]);
  const me = restored ?? loaded;
  const purchase = useStorePurchase({ enabled: me?.app_enabled === true, onConfirmed: setRestored });
  useEffect(() => {
    if (error && billingClosed(error)) router.back();
  }, [error, router]);
  const view = me && (restored || !loading) ? manageView(me, Platform.OS === 'android' ? 'android' : 'ios') : null;

  const press = {
    store: purchase.manage,
    refund: () => void WebBrowser.openBrowserAsync(REFUND_URL),
    restore: purchase.restore,
    explore: () => router.push('/pro'),
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <NavHeader title={t('pro.manageTitle')} left={<NavBackButton onPress={() => router.back()} />} />
      {!view ? (
        <SkeletonGroup style={styles.body}>
          <SkeletonBlock height={104} radius={radius.lg} />
        </SkeletonGroup>
      ) : (
        <>
          <ScrollView contentContainerStyle={styles.body}>
            <View style={[styles.status, { backgroundColor: TONE_BG[view.tone] }]}>
              {view.badge && <ProBadge />}
              {view.eyebrow && <Text style={[styles.eyebrow, { color: EYEBROW_COLOR[view.tone] }]}>{view.eyebrow}</Text>}
              <Text style={styles.title}>{view.title}</Text>
              <Text style={styles.meta}>{view.meta}</Text>
            </View>
            <View style={styles.rows}>
              {view.rows.map((row, i) => (
                <Fragment key={row.kind}>
                  {i > 0 && <View style={styles.divider} />}
                  <Pressable
                    onPress={press[row.kind]}
                    disabled={purchase.busy}
                    accessibilityRole="button"
                    style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
                    <Text style={styles.rowText}>{row.label}</Text>
                    <Feather name="chevron-right" size={20} color={palette.iconFaint} />
                  </Pressable>
                </Fragment>
              ))}
            </View>
            {purchase.busy && purchase.status ? (
              <Text style={styles.progress}>{purchase.status}</Text>
            ) : purchase.error ? (
              <InlineErrorLine message={purchase.error} />
            ) : null}
          </ScrollView>
          {view.cta && (
            <CtaBar>
              <PrimaryButton label={view.cta.label} onPress={press[view.cta.kind]} phLabel={`pro_manage_${view.cta.kind}`} />
            </CtaBar>
          )}
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  body: { paddingHorizontal: space.gutter, paddingTop: space[3], paddingBottom: space[6], gap: space[3] },
  status: { borderRadius: radius.lg, padding: space[5], gap: space[1] },
  eyebrow: type.captionBold,
  title: { ...type.title2, color: palette.text },
  meta: { ...type.caption, color: palette.textMeta },
  // 줄은 화면 끝까지 닿고 글자·구분선만 좌우 20 안쪽에 둔다.
  rows: { marginHorizontal: -space.gutter },
  row: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: space[3], paddingHorizontal: space[5] },
  pressed: { backgroundColor: palette.bgSubtle },
  rowText: { ...type.body1, flex: 1, color: palette.text },
  divider: { height: 1, marginHorizontal: space[5], backgroundColor: palette.border },
  progress: { ...type.caption, color: palette.textMeta, textAlign: 'center' },
});
