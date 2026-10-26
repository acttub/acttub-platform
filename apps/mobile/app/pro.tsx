import { Image } from 'expo-image';
import { Stack, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { NavHeader, NavIconButton } from '@/components/app-header';
import { useAppDialog } from '@/components/app-dialog';
import { ProBadge, ProCompareTable } from '@/components/pro-ui';
import { PrimaryButton } from '@/components/ui/buttons';
import { CtaBar } from '@/components/ui/cta-bar';
import { MASCOT, MASCOT_SIZE } from '@/components/ui/mascot';
import { palette } from '@/constants/palette';
import { useStorePurchase } from '@/hooks/use-store-purchase';
import { api } from '@/lib/api';
import { purchaseOpen, REFUND_URL, settingsTarget, TERMS_URL, type BillingMe } from '@/lib/billing';
import { translate as t } from '@/lib/i18n';
import type { StorePlan } from '@/lib/store-billing';

/**
 * ⑥ Pro · 안내(pen P0xJ9, SOMA-818). 설정 「ACTTUB Pro」 줄과 무료 한도 팝업의 [Pro 알아보기]가 연다. 서버가 앱 결제를 열어 두었고
 * 아직 Pro 가 아닐 때만 [Pro 시작하기]·구매 복원을 그린다(스토어 구독, 2단계). 상품명·스토어가 준 현지화 가격·1개월 자동 갱신·해지
 * 방법·약관 링크를 결제 버튼 바로 위에 둔다. 앱 안에서 웹 결제로 보내는 버튼·링크는 없다. 진행 중에는 스피너 대신 짧은 상태 문구다.
 */
export default function ProScreen() {
  const router = useRouter();
  const { alert, dialog } = useAppDialog();
  const [me, setMe] = useState<BillingMe | null>(null);
  const reload = useCallback(() => {
    void api.billingMe().then(setMe).catch(() => undefined);
  }, []);
  useEffect(reload, [reload]);
  const buyable = purchaseOpen(me);
  const [plan, setPlan] = useState<StorePlan>('monthly');
  const purchase = useStorePurchase({
    enabled: buyable,
    onConfirmed: (confirmed) => {
      setMe(confirmed);
      router.replace('/pro-done');
    },
  });

  const openHistory = async () => {
    const me = await api.billingMe().catch(() => null);
    if (me && settingsTarget(me) === '/pro-manage') router.replace('/pro-manage');
    else void alert({ title: t('pro.history'), message: t('pro.noHistory') });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <NavHeader left={<NavIconButton icon="x" size={28} label={t('common.close')} phLabel="pro_close" onPress={() => router.back()} />} />
      <ScrollView contentContainerStyle={styles.body}>
        <Image source={MASCOT.cheer} style={styles.mascot} contentFit="contain" cachePolicy="memory-disk" />
        <ProBadge />
        <Text style={styles.title}>{t('pro.title')}</Text>
        <Text style={styles.tagline}>{t('pro.tagline')}</Text>
        <ProCompareTable />
      </ScrollView>
      <CtaBar>
        {buyable ? (
          <View style={styles.notice}>
            <PlanPicker plan={plan} prices={purchase.prices} onPick={setPlan} disabled={purchase.busy} />
            <Text style={styles.noticeName}>{plan === 'yearly' ? t('pro.productNameYearly') : t('pro.productName')}</Text>
            <Text style={styles.price}>{planPrice(plan, purchase.prices[plan])}</Text>
            <Text style={styles.noticeBody}>{renewText(plan)}</Text>
          </View>
        ) : (
          <Text style={styles.price}>{me?.pro ? t('pro.alreadyPro') : t('pro.price')}</Text>
        )}
        {purchase.error && <Text style={styles.error}>{purchase.error}</Text>}
        {buyable && (
          <>
            <PrimaryButton label={purchase.busy && purchase.status ? purchase.status : t('pro.start')}
              onPress={() => purchase.begin(plan)} disabled={!purchase.available || purchase.busy || !purchase.prices[plan]}
              phLabel={plan === 'yearly' ? 'pro_start_yearly' : 'pro_start'} />
            <Pressable onPress={purchase.restore} disabled={purchase.busy} accessibilityRole="button" hitSlop={8}
              style={styles.restore}>
              <Text style={styles.link}>{t('pro.restore')}</Text>
            </Pressable>
          </>
        )}
        <View style={styles.links}>
          <Pressable onPress={() => void openHistory()} accessibilityRole="link" hitSlop={6}>
            <Text style={styles.link}>{t('pro.history')}</Text>
          </Pressable>
          <Pressable onPress={() => void WebBrowser.openBrowserAsync(TERMS_URL)} accessibilityRole="link" hitSlop={6}>
            <Text style={styles.link}>{t('pro.legal')}</Text>
          </Pressable>
          <Pressable onPress={() => void WebBrowser.openBrowserAsync(REFUND_URL)} accessibilityRole="link" hitSlop={6}>
            <Text style={styles.link}>{t('pro.refund')}</Text>
          </Pressable>
        </View>
      </CtaBar>
      {dialog}
    </SafeAreaView>
  );
}

function planPrice(plan: StorePlan, price: string | null): string {
  if (!price) return t('pro.priceLoading');
  return plan === 'yearly' ? t('pro.priceStoreYear', { price }) : t('pro.priceStore', { price });
}

function renewText(plan: StorePlan): string {
  if (Platform.OS === 'ios') return plan === 'yearly' ? t('pro.renewIosYearly') : t('pro.renewIos');
  return plan === 'yearly' ? t('pro.renewAndroidYearly') : t('pro.renewAndroid');
}

/** 월·연 요금제 고르기. 가격은 스토어가 준 현지화 값이고, 스토어에 없는 요금제는 고를 수 없다. */
function PlanPicker({ plan, prices, onPick, disabled }: {
  plan: StorePlan;
  prices: Record<StorePlan, string | null>;
  onPick: (plan: StorePlan) => void;
  disabled: boolean;
}) {
  const options: { key: StorePlan; label: string; sub: string }[] = [
    { key: 'monthly', label: t('pro.planMonthly'), sub: prices.monthly ?? '—' },
    { key: 'yearly', label: t('pro.planYearly'), sub: prices.yearly ?? '—' },
  ];
  return (
    <View style={styles.plans} accessibilityRole="radiogroup">
      {options.map((o) => {
        const selected = plan === o.key;
        const off = disabled || !prices[o.key];
        return (
          <Pressable key={o.key} onPress={() => onPick(o.key)} disabled={off} accessibilityRole="radio"
            accessibilityState={{ selected, disabled: off }} style={[styles.plan, selected && styles.planOn, off && !selected && styles.planOff]}>
            <View style={styles.planHead}>
              <Text style={[styles.planLabel, selected && styles.planLabelOn]}>{o.label}</Text>
              {o.key === 'yearly' && <Text style={styles.planBadge}>{t('pro.planYearlyBadge')}</Text>}
            </View>
            <Text style={styles.planSub}>{o.sub}</Text>
            {o.key === 'yearly' && <Text style={styles.planHint}>{t('pro.planYearlyHint')}</Text>}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  plans: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  plan: { flex: 1, borderWidth: 1.5, borderColor: palette.border, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14, backgroundColor: palette.card },
  planOn: { borderColor: palette.blue, backgroundColor: palette.blueMist },
  planOff: { opacity: 0.5 },
  planHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  planLabel: { fontSize: 15, fontWeight: '700', color: palette.textStrong },
  planLabelOn: { color: palette.blueDeep },
  planBadge: { fontSize: 11, fontWeight: '800', color: palette.onAccent, backgroundColor: palette.blue, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, overflow: 'hidden' },
  planSub: { fontSize: 13, color: palette.textDim },
  planHint: { fontSize: 11, color: palette.textFaint, marginTop: 2 },
  safe: { flex: 1, backgroundColor: palette.bg },
  body: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 24, gap: 10 },
  mascot: { ...MASCOT_SIZE.lg, marginBottom: 6 },
  title: { fontSize: 24, fontWeight: '800', color: palette.text },
  tagline: { fontSize: 15, color: palette.textDim, lineHeight: 22, marginBottom: 14 },
  price: { fontSize: 15, fontWeight: '700', color: palette.text, textAlign: 'center', marginBottom: 12 },
  notice: { marginBottom: 4 },
  noticeName: { fontSize: 13, color: palette.textDim, textAlign: 'center', marginBottom: 2 },
  noticeBody: { fontSize: 12, color: palette.textFaint, lineHeight: 17, textAlign: 'center', marginBottom: 12 },
  restore: { alignSelf: 'center', paddingVertical: 10 },
  error: { fontSize: 13, color: palette.danger, textAlign: 'center', marginBottom: 8 },
  links: { flexDirection: 'row', justifyContent: 'center', gap: 18, marginTop: 14 },
  link: { fontSize: 12, color: palette.textFaint },
});
