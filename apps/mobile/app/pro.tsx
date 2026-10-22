import { Image } from 'expo-image';
import { Stack, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { NavHeader, NavIconButton } from '@/components/app-header';
import { useAppDialog } from '@/components/app-dialog';
import { ExternalPurchaseNotice, ProBadge, ProCompareTable } from '@/components/pro-ui';
import { PrimaryButton } from '@/components/ui/buttons';
import { CtaBar } from '@/components/ui/cta-bar';
import { MASCOT, MASCOT_SIZE } from '@/components/ui/mascot';
import { palette } from '@/constants/palette';
import { useProCheckout } from '@/hooks/use-pro-checkout';
import { api } from '@/lib/api';
import { REFUND_URL, settingsTarget, TERMS_URL } from '@/lib/billing';
import { translate as t } from '@/lib/i18n';

/**
 * ⑥ Pro · 안내(pen P0xJ9, SOMA-818). 설정 「ACTTUB Pro」 줄과 무료 한도 시트의 [Pro 알아보기]가 연다. [Pro 시작하기]는 iOS 면
 * 외부 결제 안내(hD5to)를 거쳐 토스 카드 등록 창(t2V04c, 토스 화면)을 브라우저로 연다. 결제는 토스페이먼츠 자동결제다.
 */
export default function ProScreen() {
  const router = useRouter();
  const { alert, dialog } = useAppDialog();
  const checkout = useProCheckout();

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
        {checkout.error && <Text style={styles.error}>{checkout.error}</Text>}
        <PrimaryButton label={t('pro.start')} onPress={() => checkout.begin('subscribe')} loading={checkout.busy}
          disabled={checkout.busy} phLabel="pro_start" />
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
  body: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 24, gap: 10 },
  mascot: { ...MASCOT_SIZE.lg, marginBottom: 6 },
  title: { fontSize: 24, fontWeight: '800', color: palette.text },
  tagline: { fontSize: 15, color: palette.textDim, lineHeight: 22, marginBottom: 14 },
  price: { fontSize: 15, fontWeight: '700', color: palette.text, textAlign: 'center', marginBottom: 12 },
  error: { fontSize: 13, color: palette.danger, textAlign: 'center', marginBottom: 8 },
  links: { flexDirection: 'row', justifyContent: 'center', gap: 18, marginTop: 14 },
  link: { fontSize: 12, color: palette.textFaint },
});
