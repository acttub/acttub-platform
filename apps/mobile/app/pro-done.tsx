import { Image } from 'expo-image';
import { Stack, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/ds/ui/buttons';
import { CtaBar } from '@/components/ds/ui/cta-bar';
import { MASCOT, MASCOT_SIZE } from '@/components/ui/mascot';
import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';
import { api } from '@/lib/api';
import { doneSummary, type BillingMe } from '@/lib/billing';
import { translate as t } from '@/lib/i18n';

/** ⑥ Pro · 결제 완료(SOMA-818). 완료 화면 틀 — 머리 없이 기쁜 액티 · 제목 · 설명 · 요금제 요약 · 아래 고정 [확인]. */
export default function ProDoneScreen() {
  const router = useRouter();
  const [me, setMe] = useState<BillingMe | null>(null);
  useEffect(() => {
    void api.billingMe().then(setMe).catch(() => undefined);
  }, []);
  const rows = doneSummary(me);
  const leave = () => (router.canGoBack() ? router.back() : router.replace('/settings'));
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
      <ScrollView contentContainerStyle={styles.body}>
        <Image source={MASCOT.jump} style={MASCOT_SIZE.xl} contentFit="contain" cachePolicy="memory-disk" />
        <Text style={styles.title} accessibilityRole="header">{t('pro.doneTitle')}</Text>
        <Text style={styles.sub}>{t('pro.doneBody')}</Text>
        {rows.length > 0 && (
          <View style={styles.summary}>
            {rows.map((row) => (
              <View key={row.label} style={styles.row}>
                <Text style={styles.label}>{row.label}</Text>
                <Text style={styles.value}>{row.value}</Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
      <CtaBar>
        <PrimaryButton label={t('common.confirm')} onPress={leave} phLabel="pro_done_confirm" />
      </CtaBar>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  body: { paddingTop: 96, paddingHorizontal: space.gutter, paddingBottom: space[6], gap: space[3], alignItems: 'center' },
  title: { ...type.title1, color: palette.text, textAlign: 'center' },
  sub: { ...type.body2, color: palette.textSub, textAlign: 'center' },
  summary: {
    alignSelf: 'stretch',
    gap: space[3],
    padding: space[4],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.bgSubtle,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: space[3] },
  label: { ...type.body2, color: palette.textMeta },
  value: { ...type.body2Bold, color: palette.text },
});
