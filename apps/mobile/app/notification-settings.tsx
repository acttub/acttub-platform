import { Stack, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { NavBackButton, NavHeader } from '@/components/app-header';
import { useAppDialog } from '@/components/app-dialog';
import Feather from '@expo/vector-icons/Feather';
import { BlueSwitch } from '@/components/ui/list-rows';
import { palette } from '@/constants/palette';
import { translate as t } from '@/lib/i18n';
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  loadNotificationSettings,
  setNotificationToggle,
  type NotificationSettings,
} from '@/lib/notifications';

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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [updatingToggle, setUpdatingToggle] = useState<keyof NotificationSettings | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setNotif(await loadNotificationSettings());
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : t('common.tryLater'));
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
        <View style={styles.center}>
          <ActivityIndicator color={palette.blue} />
        </View>
      ) : loadError ? (
        <View style={styles.center}>
          <Text style={styles.loadError}>{loadError}</Text>
          <Pressable style={styles.reloadBtn} onPress={() => void load()} accessibilityRole="button">
            <Text style={styles.reloadText}>{t('consent.reload')}</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          <Text style={styles.section}>{t('settings.pushSection')}</Text>
          {NOTIFICATION_TOGGLES.map((toggle) => (
            <View key={toggle.key} style={styles.card}>
              <View style={styles.iconWrap}>
                <Feather name={TOGGLE_ICON[toggle.key] ?? 'bell'} size={20} color={palette.blue} />
              </View>
              <View style={styles.cardText}>
                <Text style={styles.cardTitle}>{t(toggle.titleKey)}</Text>
                <Text style={styles.cardSub}>{t(toggle.subKey)}</Text>
              </View>
              <BlueSwitch
                value={notif[toggle.key]}
                onValueChange={(v) => void toggleNotification(toggle.key, v)}
                disabled={updatingToggle !== null}
                accessibilityLabel={t(toggle.titleKey)}
              />
            </View>
          ))}
        </ScrollView>
      )}
      {dialog}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  list: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 24, gap: 10 },
  section: { fontSize: 15, fontWeight: '800', color: palette.text, marginBottom: 4 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 22,
  },
  iconWrap: { width: 40, height: 40, borderRadius: 20, backgroundColor: palette.blueSoft, alignItems: 'center', justifyContent: 'center' },
  cardText: { flex: 1, gap: 2 },
  cardTitle: { fontSize: 17, fontWeight: '800', color: palette.text },
  cardSub: { fontSize: 13, color: palette.textMuted, lineHeight: 18 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadError: { color: palette.danger, fontSize: 14, textAlign: 'center', paddingHorizontal: 24 },
  reloadBtn: { marginTop: 12, paddingHorizontal: 16, paddingVertical: 10 },
  reloadText: { color: palette.blue, fontSize: 14, fontWeight: '700' },
});
