import { Stack, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { NavBackButton, NavHeader } from '@/components/app-header';
import { useAppDialog } from '@/components/app-dialog';
import { InlineError } from '@/components/ui/inline-error';
import { BlueSwitch } from '@/components/ui/list-rows';
import { SettingsCard } from '@/components/ui/settings-card';
import { palette } from '@/constants/palette';
import { space, type } from '@/constants/tokens';
import { translate as t } from '@/lib/i18n';
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  loadNotificationSettings,
  setNotificationToggle,
  type NotificationSettings,
} from '@/lib/notifications';
import { SkeletonRows } from '@/components/ui/skeleton';

/** 알림 토글 셋. 순서대로 그린다. */
const TOGGLE_ICON: Record<string, 'star' | 'award' | 'moon' | 'bell'> = {
  analysis_done: 'star',
  challenge: 'award',
  evening_reminder: 'moon',
};

const NOTIFICATION_TOGGLES: { key: keyof NotificationSettings; titleKey: string; subKey: string }[] = [
  { key: 'analysis_done', titleKey: 'settings.notifAnalysisTitle', subKey: 'settings.notifAnalysisSub' },
  { key: 'challenge', titleKey: 'settings.notifChallengeShort', subKey: 'settings.notifChallengeSub' },
  { key: 'evening_reminder', titleKey: 'settings.notifReminderShort', subKey: 'settings.notifReminderSub' },
];

/**
 * 알림 설정(pen 「알림 설정」, SOMA-748) — 예전 설정 화면의 알림 묶음을 따로 뺐다. 토글 셋(분석 완료·챌린지·저녁
 * 리마인드)은 서버의 프로필에 저장돼 폰을 바꿔도 유지된다. 휴대폰 알림 권한이 꺼져 있으면 「알림이 꺼져 있어요」로 보낸다.
 */
export default function NotificationSettingsScreen() {
  const router = useRouter();
  const { alert, dialog } = useAppDialog();
  const [notif, setNotif] = useState<NotificationSettings>(DEFAULT_NOTIFICATION_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [updatingToggle, setUpdatingToggle] = useState<keyof NotificationSettings | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      setNotif(await loadNotificationSettings());
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleNotification = useCallback(
    async (key: keyof NotificationSettings, next: boolean) => {
      if (updatingToggle) return;
      const previous = notif;
      setUpdatingToggle(key);
      setNotif({ ...previous, [key]: next }); // 낙관적 업데이트
      try {
        const result = await setNotificationToggle(previous, key, next);
        setNotif(result.settings);
        // OS 알림 권한이 꺼져 있으면 토글을 켜도 알림이 오지 않는다. 권한 안내 화면으로 보낸다.
        if (result.kind === 'permission_blocked') router.push('/notification-off');
      } catch (err) {
        setNotif(previous); // 실패 시 롤백
        void alert({
          title: t('settings.changeFailTitle'),
          message: err instanceof Error ? err.message : t('common.tryLater'),
        });
      } finally {
        setUpdatingToggle(null);
      }
    },
    [notif, updatingToggle, alert, router],
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <NavHeader title={t('settings.notifications')} left={<NavBackButton onPress={() => router.back()} />} />
      {loading ? (
        <SkeletonRows count={5} avatar={false} />
      ) : loadError ? (
        <View style={styles.list}>
          <InlineError message={t('settings.notifLoadFail')} onRetry={() => void load()} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          <Text style={styles.section}>{t('settings.pushSection')}</Text>
          {NOTIFICATION_TOGGLES.map((toggle) => (
            <SettingsCard
              key={toggle.key}
              iconCircle
              icon={TOGGLE_ICON[toggle.key] ?? 'bell'}
              title={t(toggle.titleKey)}
              sub={t(toggle.subKey)}
              right={
                <BlueSwitch
                  value={notif[toggle.key]}
                  onValueChange={(v) => void toggleNotification(toggle.key, v)}
                  disabled={updatingToggle !== null}
                  accessibilityLabel={t(toggle.titleKey)}
                />
              }
            />
          ))}
        </ScrollView>
      )}
      {dialog}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  list: { paddingHorizontal: space.gutter, paddingTop: space[2], paddingBottom: space[6], gap: space[2] },
  section: { ...type.captionBold, color: palette.textSub },
});
