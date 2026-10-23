import Constants from 'expo-constants';
import { Image } from 'expo-image';
import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { BackHandler, Linking, Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/ui/buttons';
import { MASCOT, MASCOT_SIZE } from '@/components/ui/mascot';
import { palette } from '@/constants/palette';
import { translate as t } from '@/lib/i18n';
import { storeUrlFor } from '@/lib/update-required';

const STORE_URL = storeUrlFor({
  platform: Platform.OS,
  androidPackage: Constants.expoConfig?.android?.package,
  iosAppStoreUrl: process.env.EXPO_PUBLIC_IOS_APP_STORE_URL ?? '',
});

/**
 * 업데이트 안내(pen S2.1) — 서버가 426으로 답하면 _layout 게이트가 이 화면만 보여 준다.
 * 가운데에 웃는 액티와 회색 말풍선(제목·설명), 맨 아래에 「업데이트」 큰 버튼. 이 빌드로는 어떤 요청도 통하지
 * 않으므로 닫는 길(취소·뒤로 가기)을 두지 않는다.
 */
export default function UpdateRequiredScreen() {
  const [openFailed, setOpenFailed] = useState(false);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => subscription.remove();
  }, []);

  const openStore = async () => {
    if (!STORE_URL) return;
    setOpenFailed(false);
    try {
      await Linking.openURL(STORE_URL);
    } catch {
      setOpenFailed(true);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
      <View style={styles.center}>
        <Image source={MASCOT.home} style={MASCOT_SIZE.hero} contentFit="contain" accessibilityIgnoresInvertColors />
        <View style={styles.bubble}>
          <Text style={styles.title}>{t('updateRequired.title')}</Text>
          <Text style={styles.body}>{t('updateRequired.body')}</Text>
          {openFailed && <Text style={styles.error}>{t('updateRequired.openFail')}</Text>}
        </View>
      </View>
      <View style={styles.footer}>
        {STORE_URL ? (
          <PrimaryButton label={t('updateRequired.cta')} onPress={() => void openStore()} style={styles.cta} />
        ) : (
          <Text style={styles.manual}>{t('updateRequired.manual')}</Text>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.bg },
  center: { flex: 1, justifyContent: 'center', paddingHorizontal: 24, gap: 8 },
  bubble: { gap: 6, paddingVertical: 14, paddingHorizontal: 16, backgroundColor: palette.bgSoft, borderRadius: 16 },
  title: { fontSize: 20, fontWeight: '800', lineHeight: 27, color: palette.text, textAlign: 'center' },
  body: { fontSize: 15, fontWeight: '500', lineHeight: 22.5, color: palette.textMuted, textAlign: 'center' },
  footer: { paddingHorizontal: 24, paddingBottom: 12 },
  cta: { height: 52 },
  error: { fontSize: 13, lineHeight: 19.5, color: palette.danger, textAlign: 'center', marginTop: 4 },
  manual: { fontSize: 14, fontWeight: '700', color: palette.text, textAlign: 'center', paddingVertical: 16 },
});
