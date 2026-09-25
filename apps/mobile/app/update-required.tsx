import Constants from 'expo-constants';
import { Image } from 'expo-image';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { palette } from '@/constants/palette';
import { translate as t } from '@/lib/i18n';
import { storeUrlFor } from '@/lib/update-required';

const STORE_URL = storeUrlFor({
  platform: Platform.OS,
  androidPackage: Constants.expoConfig?.android?.package,
  iosAppStoreUrl: process.env.EXPO_PUBLIC_IOS_APP_STORE_URL ?? '',
});

/**
 * 업데이트 안내 — 서버가 426으로 답하면 _layout 게이트가 이 화면만 보여 준다.
 *
 * 이 빌드로는 어떤 요청도 통하지 않으므로 나가는 길을 두지 않는다. 할 수 있는 일은
 * 스토어에서 새 버전을 받는 것 하나다.
 */
export default function UpdateRequiredScreen() {
  const [openFailed, setOpenFailed] = useState(false);

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
    <SafeAreaView style={styles.safe}>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
      <View style={styles.body}>
        <Image
          source={require('@/assets/images/logo-wordmark.png')}
          style={styles.logo}
          contentFit="contain"
        />
        <Text style={styles.title}>{t('updateRequired.title')}</Text>
        <Text style={styles.message}>{t('updateRequired.body')}</Text>
      </View>
      <View style={styles.footer}>
        {openFailed && <Text style={styles.error}>{t('updateRequired.openFail')}</Text>}
        {STORE_URL ? (
          <Pressable
            style={({ pressed }) => [styles.cta, pressed && styles.pressed]}
            onPress={() => void openStore()}
            accessibilityRole="button">
            <Text style={styles.ctaText}>{t('updateRequired.cta')}</Text>
          </Pressable>
        ) : (
          <Text style={styles.message}>{t('updateRequired.manual')}</Text>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg, paddingHorizontal: 28 },
  body: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 14 },
  logo: { width: 180, height: 72, marginBottom: 8 },
  title: { fontSize: 22, fontWeight: '800', color: palette.text, textAlign: 'center' },
  message: { fontSize: 15, lineHeight: 22, color: palette.textDim, textAlign: 'center' },
  footer: { paddingBottom: 28, gap: 12 },
  cta: { backgroundColor: palette.blue, borderRadius: 16, padding: 17, alignItems: 'center' },
  pressed: { opacity: 0.7 },
  ctaText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  error: { color: palette.danger, fontSize: 13, textAlign: 'center' },
});
