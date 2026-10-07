import Constants from 'expo-constants';
import { Image } from 'expo-image';
import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { BackHandler, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/palette';
import { translate as t } from '@/lib/i18n';
import { storeUrlFor } from '@/lib/update-required';

const STORE_URL = storeUrlFor({
  platform: Platform.OS,
  androidPackage: Constants.expoConfig?.android?.package,
  iosAppStoreUrl: process.env.EXPO_PUBLIC_IOS_APP_STORE_URL ?? '',
});

// 네이티브 스플래시와 같은 자리·크기. iOS는 app.json의 imageWidth 200,
// 안드로이드 12+는 시스템이 적응형 아이콘을 160dp로 그린다(plugins/with-splash-adaptive-icon.js).
const SPLASH_ICON_SIZE = Platform.OS === 'ios' ? 200 : 160;

/**
 * 업데이트 안내 — 서버가 426으로 답하면 _layout 게이트가 이 화면만 보여 준다.
 *
 * 스플래시와 같은 흰 바탕·가운데 아이콘을 그리고 그 위에 막과 팝업을 얹는다. 앱을 켜자마자
 * 426이 오면 스플래시가 내려가도 그림이 바뀌지 않고 팝업만 떠오른다.
 * 이 빌드로는 어떤 요청도 통하지 않으므로 닫는 길(취소·뒤로 가기)을 두지 않는다.
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
      <View style={styles.splash}>
        <Image
          source={require('@/assets/images/splash-icon-ios.png')}
          style={styles.splashIcon}
          contentFit="contain"
        />
      </View>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>{t('updateRequired.title')}</Text>
          <Text style={styles.message}>{t('updateRequired.body')}</Text>
          {openFailed && <Text style={styles.error}>{t('updateRequired.openFail')}</Text>}
          {STORE_URL ? (
            <Pressable
              style={({ pressed }) => [styles.cta, pressed && styles.pressed]}
              onPress={() => void openStore()}
              accessibilityRole="button">
              <Text style={styles.ctaText}>{t('updateRequired.cta')}</Text>
            </Pressable>
          ) : (
            <Text style={styles.manual}>{t('updateRequired.manual')}</Text>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.bg },
  splash: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  splashIcon: { width: SPLASH_ICON_SIZE, height: SPLASH_ICON_SIZE },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 21, 37, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
  },
  card: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: palette.card,
    borderRadius: 22,
    paddingHorizontal: 22,
    paddingTop: 24,
    paddingBottom: 18,
  },
  title: { fontSize: 17, fontWeight: '800', color: palette.text, textAlign: 'center' },
  message: {
    fontSize: 14,
    color: palette.textDim,
    lineHeight: 21,
    textAlign: 'center',
    marginTop: 10,
  },
  error: {
    fontSize: 13,
    lineHeight: 19.5,
    color: palette.danger,
    textAlign: 'center',
    marginTop: 10,
  },
  cta: {
    marginTop: 22,
    backgroundColor: palette.blue,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  pressed: { opacity: 0.75 },
  ctaText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  manual: {
    marginTop: 22,
    fontSize: 14,
    fontWeight: '700',
    color: palette.text,
    textAlign: 'center',
  },
});
