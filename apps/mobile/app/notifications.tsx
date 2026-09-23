import Feather from '@expo/vector-icons/Feather';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAppDialog } from '@/components/app-dialog';
import { palette } from '@/constants/palette';
import { logEvent } from '@/lib/analytics';
import { api } from '@/lib/api';
import { avatarLetter } from '@/lib/challenge/browse';
import {
  groupLabel,
  markAllRead,
  markGroupRead,
  sortGroups,
  targetOf,
  toggleOffNotice,
  unavailableMessage,
} from '@/lib/challenge/notification-center';
import type { NotificationGroup } from '@/lib/challenge/types';
import { relativeDayLabel } from '@/lib/archive-format';
import { translate as t } from '@/lib/i18n';
import { loadNotificationSettings } from '@/lib/notifications';

/**
 * 알림함(challenge.notification) — 묶음 20개씩, 묶음의 최신 사건 순.
 *
 * 묶음을 누르면 포함된 사건 전부가 읽음이 되고 대상으로 간다. 대상이 보이지 않으면 "볼 수 없는
 * 영상"만 알린다(내가 요청한 AI 리포트는 비공개 참여작이어도 열린다). "모두 읽음"은 그 시각까지의
 * 것만 읽음으로 바꾼다. 챌린지 알림 토글을 꺼도 여기에는 쌓인다. 90일이 지나면 사라진다.
 */
export default function NotificationsScreen() {
  const router = useRouter();
  const { alert, dialog } = useAppDialog();
  const [groups, setGroups] = useState<NotificationGroup[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [pushEnabled, setPushEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const result = await api.listNotifications();
      setGroups(sortGroups(result.groups));
      setCursor(result.next_cursor);
    } catch {
      setGroups([]);
      setError(t('notifications.loadFail'));
    }
    // 토글이 꺼져 있으면 머리에 알린다(알림함에는 계속 쌓인다).
    void loadNotificationSettings()
      .then((settings) => setPushEnabled(settings.challenge))
      .catch(() => undefined);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const loadMore = async () => {
    if (!cursor) return;
    const result = await api.listNotifications(cursor).catch(() => null);
    if (!result) return;
    setGroups((prev) => sortGroups([...(prev ?? []), ...result.groups]));
    setCursor(result.next_cursor);
  };

  const open = async (group: NotificationGroup) => {
    setGroups((prev) => markGroupRead(prev ?? [], group.group_key));
    void api.readNotifications({ group_keys: [group.group_key] }).catch(() => undefined);
    const target = targetOf(group);
    logEvent('notification_open', { kind: group.kind, target: target.kind });
    if (target.kind === 'unavailable') {
      void alert({ title: t('notifications.title'), message: unavailableMessage() });
      return;
    }
    if (target.kind === 'report') {
      router.push({ pathname: '/ai-report', params: { entryId: target.entryId } });
      return;
    }
    if (target.kind === 'challenge') {
      router.push({ pathname: '/challenge-detail', params: { id: target.challengeId } });
      return;
    }
    router.push({ pathname: '/challenge-play', params: { id: target.challengeId, entryId: target.entryId } });
  };

  const readAll = async () => {
    const newest = groups?.[0];
    if (!newest) return;
    setGroups((prev) => markAllRead(prev ?? [], { at: newest.latest_at, groupKey: newest.group_key }));
    await api
      .readNotifications({ all_before: { created_at: newest.latest_at, id: newest.group_key } })
      .catch(() => undefined);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('common.back')}>
          <Feather name="chevron-left" size={26} color={palette.text} />
        </Pressable>
        <Text style={styles.title}>{t('notifications.title')}</Text>
        <View style={styles.flex} />
        <Pressable onPress={() => void readAll()} hitSlop={10} accessibilityRole="button">
          <Text style={styles.readAll}>{t('notifications.markAll')}</Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        onMomentumScrollEnd={() => void loadMore()}>
        {!pushEnabled && <Text style={styles.pushOff}>{toggleOffNotice(pushEnabled)}</Text>}
        {groups === null && !error && <ActivityIndicator color={palette.blue} style={{ marginTop: 32 }} />}
        {!!error && <Text style={styles.error}>{error}</Text>}
        {groups !== null && groups.length === 0 && !error && <Text style={styles.empty}>{t('notifications.empty')}</Text>}

        {groups?.map((group) => (
          <Pressable key={group.group_key} style={styles.row} onPress={() => void open(group)} accessibilityRole="button">
            <View style={[styles.avatar, !group.read && styles.avatarUnread]}>
              <Text style={styles.avatarText}>{avatarLetter(group.actor_name ?? t('notifications.title'))}</Text>
            </View>
            <View style={styles.rowBody}>
              <Text style={[styles.rowText, !group.read && styles.rowTextUnread]} numberOfLines={2}>
                {groupLabel(group)}
              </Text>
              <Text style={styles.rowMeta}>{relativeDayLabel(group.latest_at)}</Text>
            </View>
            {!group.read && <View style={styles.dot} />}
          </Pressable>
        ))}

        {groups !== null && groups.length > 0 && <Text style={styles.keep}>{t('notifications.keep')}</Text>}
      </ScrollView>
      {dialog}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 6 },
  title: { fontSize: 18, fontWeight: '800', color: palette.text },
  readAll: { fontSize: 13, fontWeight: '800', color: palette.blueDeep },
  body: { padding: 16, paddingBottom: 48 },
  pushOff: {
    fontSize: 12.5,
    color: palette.amber,
    backgroundColor: palette.amberSoft,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    lineHeight: 19,
  },
  error: { color: palette.danger, fontSize: 13.5, fontWeight: '700', textAlign: 'center', paddingVertical: 16 },
  empty: { color: palette.textDim, fontSize: 14.5, textAlign: 'center', paddingVertical: 48 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: palette.borderSoft,
  },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: palette.bgSoft, alignItems: 'center', justifyContent: 'center' },
  avatarUnread: { backgroundColor: palette.blueSoft },
  avatarText: { fontSize: 14, fontWeight: '900', color: palette.blueDeep },
  rowBody: { flex: 1, gap: 3 },
  rowText: { fontSize: 14.5, color: palette.textDim, lineHeight: 21 },
  rowTextUnread: { fontWeight: '800', color: palette.text },
  rowMeta: { fontSize: 12, color: palette.textFaint },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: palette.blue },
  keep: { fontSize: 12, color: palette.textFaint, textAlign: 'center', paddingTop: 16 },
});
