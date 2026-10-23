import Constants from 'expo-constants';
import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { BackHandler, Linking, Platform, StyleSheet, Text, View } from 'react-native';

import { DialogButtons, DialogCard } from '@/components/ui/dialog';
import { SplashBackdrop } from '@/components/ui/splash-backdrop';
import { palette } from '@/constants/palette';
import { translate as t } from '@/lib/i18n';
import { storeUrlFor } from '@/lib/update-required';

const STORE_URL = storeUrlFor({
  platform: Platform.OS,
  androidPackage: Constants.expoConfig?.android?.package,
  iosAppStoreUrl: process.env.EXPO_PUBLIC_IOS_APP_STORE_URL ?? '',
});

/**
 * 업데이트 안내(pen S2.1~S2.3) — 서버가 426으로 답하면 _layout 게이트가 이 화면만 보여 준다.
 * 하늘 스플래시 위에 어두운 막을 깔고 가운데 팝업(제목·설명·「업데이트」 한 칸)을 띄운다. 이 빌드로는 어떤 요청도
 * 통하지 않으므로 닫는 길(취소·뒤로 가기)을 두지 않는다.
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
      <SplashBackdrop>
        <View style={styles.scrim}>
          <DialogCard title={t('updateRequired.title')} message={t('updateRequired.body')}>
            {openFailed && <Text style={styles.error}>{t('updateRequired.openFail')}</Text>}
            {STORE_URL ? (
              <DialogButtons confirmLabel={t('updateRequired.cta')} onConfirm={() => void openStore()} />
            ) : (
              <Text style={styles.manual}>{t('updateRequired.manual')}</Text>
            )}
          </DialogCard>
        </View>
      </SplashBackdrop>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: '#0F152573', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  error: { fontSize: 13, lineHeight: 19.5, color: palette.danger, textAlign: 'center', marginTop: 10 },
  manual: { fontSize: 14, fontWeight: '700', lineHeight: 21, color: palette.text, textAlign: 'center', marginTop: 10 },
});
