import { Stack, useRouter } from 'expo-router';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MASCOT } from '@/components/ui/mascot';
import { StatusScreen } from '@/components/ui/status-screen';
import { palette } from '@/constants/palette';
import { translate as t } from '@/lib/i18n';

/** ⑥ Pro · 결제 완료(pen kqeG6, SOMA-818). 머리 없이 기쁜 액티 · 제목 · 설명 · [계속하기]. */
export default function ProDoneScreen() {
  const router = useRouter();
  const leave = () => (router.canGoBack() ? router.back() : router.replace('/settings'));
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
      <StatusScreen
        mascot={MASCOT.jump}
        title={t('pro.doneTitle')}
        body={t('pro.doneBody')}
        primary={{ label: t('pro.continue'), onPress: leave }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: palette.bg } });
