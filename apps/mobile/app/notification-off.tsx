import { Stack, useRouter } from 'expo-router';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { NavBackButton, NavHeader } from '@/components/app-header';
import { AccountStatus } from '@/components/ui/account-status';
import { PrimaryButton, SecondaryButton } from '@/components/ui/buttons';
import { palette } from '@/constants/palette';
import { translate as t } from '@/lib/i18n';
import { openNotificationPermissionSettings } from '@/lib/notifications';

const MASCOT = require('@/assets/images/mascot-coach.png');

/**
 * 알림이 꺼져 있어요(pen QsOcR, SOMA-748) — 알림 토글을 켰는데 휴대폰 알림 권한이 꺼져 있을 때. 예전엔 확인창이었다.
 * 「설정에서 켜기」는 휴대폰 설정을 열고, 「알림 없이 할게요」는 알림 설정으로 돌아간다.
 */
export default function NotificationOffScreen() {
  const router = useRouter();
  const back = () => (router.canGoBack() ? router.back() : router.replace('/settings'));
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <NavHeader title={t('settings.notifications')} left={<NavBackButton onPress={back} />} />
      <AccountStatus
        mascot={MASCOT}
        title={t('settings.notifPermissionTitle')}
        hint={t('settings.notifOffHint')}
        actions={
          <>
            <PrimaryButton
              label={t('settings.notifOffOpen')}
              onPress={() => void openNotificationPermissionSettings().catch(() => undefined)}
            />
            <SecondaryButton label={t('settings.notifOffSkip')} onPress={back} />
          </>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
});
