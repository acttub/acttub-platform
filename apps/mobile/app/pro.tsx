import { Image } from 'expo-image';
import { Stack, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
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
import { REFUND_URL, settingsTarget, TERMS_URL } from '@/lib/billing';
import { translate as t } from '@/lib/i18n';

/**
 * ⑥ Pro · 안내(pen P0xJ9, SOMA-818). 설정 「ACTTUB Pro」 줄과 무료 한도 팝업의 [Pro 알아보기]가 연다. [Pro 시작하기]는 스토어 구독
 * (2단계)이 붙을 자리이고 지금은 그리지 않는다. 앱 안에서 웹 결제로 보내는 버튼·링크는 없다.
 */
export default function ProScreen() {
  const router = useRouter();
  const { alert, dialog } = useAppDialog();
  const purchase = useStorePurchase();

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
        <Text style={styles.price}>{t('pro.price')}</Text>
        {purchase.error && <Text style={styles.error}>{purchase.error}</Text>}
        {/* 구매 버튼은 스토어 결제(2단계)가 붙을 때만 그린다. */}
        {purchase.available && (
          <PrimaryButton label={t('pro.start')} onPress={purchase.begin} loading={purchase.busy}
            disabled={purchase.busy} phLabel="pro_start" />
        )}
        <View style={styles.links}>
          <Pressable onPress={() => void openHistory()} accessibilityRole="link" hitSlop={6}>
            <Text style={styles.link}>{t('pro.history')}</Text>
          </Pressable>
          <Pressable onPress={() => void WebBrowser.openBrowserAsync(TERMS_URL)} accessibilityRole="link" hitSlop={6}>
            <Text style={styles.link}>{t('pro.terms')}</Text>
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
  error: { fontSize: 13, color: palette.danger, textAlign: 'center', marginBottom: 8 },
  links: { flexDirection: 'row', justifyContent: 'center', gap: 18, marginTop: 14 },
  link: { fontSize: 12, color: palette.textFaint },
});
