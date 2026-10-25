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
        <Image source={MASCOT.cheer} style={styles.mascot} contentFit="contain" />
        <ProBadge />
        <Text style={styles.title}>{t('pro.title')}</Text>
        <Text style={styles.tagline}>{t('pro.tagline')}</Text>
        <ProCompareTable />
      </ScrollView>
      <CtaBar>
        {buyable ? (
          <View style={styles.notice}>
            <Text style={styles.noticeName}>{t('pro.productName')}</Text>
            <Text style={styles.price}>
              {purchase.price ? t('pro.priceStore', { price: purchase.price }) : t('pro.priceLoading')}
            </Text>
            <Text style={styles.noticeBody}>{Platform.OS === 'ios' ? t('pro.renewIos') : t('pro.renewAndroid')}</Text>
          </View>
        ) : (
          <Text style={styles.price}>{me?.pro ? t('pro.alreadyPro') : t('pro.price')}</Text>
        )}
        {purchase.error && <Text style={styles.error}>{purchase.error}</Text>}
        {buyable && (
          <>
            <PrimaryButton label={purchase.busy && purchase.status ? purchase.status : t('pro.start')}
              onPress={purchase.begin} disabled={!purchase.available || purchase.busy} phLabel="pro_start" />
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

const styles = StyleSheet.create({
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
