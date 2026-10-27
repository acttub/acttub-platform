import Constants from 'expo-constants';
import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { BackHandler, Linking, Platform, StyleSheet, Text, View } from 'react-native';

import { InlineErrorLine } from '@/components/ui/inline-error';
import { MASCOT } from '@/components/ui/mascot';
import { StatusScreen } from '@/components/ui/status-screen';
import { palette } from '@/constants/palette';
import { type } from '@/constants/tokens';
import { translate as t } from '@/lib/i18n';
import { storeUrlFor } from '@/lib/update-required';

const STORE_URL = storeUrlFor({
  platform: Platform.OS,
  androidPackage: Constants.expoConfig?.android?.package,
  iosAppStoreUrl: process.env.EXPO_PUBLIC_IOS_APP_STORE_URL ?? '',
});

/**
 * 업데이트 안내(pen root.update-gate · update-required.no-store-url) — 서버가 426으로 답하면 _layout 게이트가 이 화면만 보여 준다.
 * StatusScreen 하나(마스코트 · 제목 · 설명 · 「업데이트하기」). 이 빌드로는 어떤 요청도 통하지 않으므로 닫는 길(뒤로 가기)을 두지 않는다.
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
    <View style={styles.root}>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
      <StatusScreen
        safeArea
        mascot={MASCOT.nervous}
        title={t('updateRequired.title')}
        body={t('updateRequired.body')}
        primary={STORE_URL ? { label: t('updateRequired.cta'), onPress: () => void openStore() } : undefined}>
        {openFailed && <InlineErrorLine message={t('updateRequired.openFail')} />}
        {!STORE_URL && <Text style={styles.manual}>{t('updateRequired.manual')}</Text>}
      </StatusScreen>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.bg },
  manual: { ...type.body2Bold, color: palette.text, textAlign: 'center' },
});
