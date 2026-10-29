import Feather from '@expo/vector-icons/Feather';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AdSlot } from '@/components/ad-slot';
import { useAppDialog } from '@/components/app-dialog';
import { TextButton } from '@/components/ui/buttons';
import { DefaultAvatar } from '@/components/ui/default-avatar';
import { InlineEmpty } from '@/components/ui/inline-empty';
import { InlineError } from '@/components/ui/inline-error';
import { NavBackButton, NavHeader } from '@/components/ui/nav-header';
import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';
import { logEvent } from '@/lib/analytics';
import { api } from '@/lib/api';
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
import { SkeletonRows } from '@/components/ui/skeleton';

/**
 * 알림함(challenge.notification) — 묶음 20개씩, 묶음의 최신 사건 순.
 *
 * 묶음을 누르면 포함된 사건 전부가 읽음이 되고 대상으로 간다. 대상이 보이지 않으면 "볼 수 없는
 * 영상"만 알린다. "모두 읽음"은 그 시각까지의
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
      void alert({ title: unavailableMessage(target) });
      return;
    }
    if (target.kind === 'home') {
      router.dismissTo('/(tabs)');
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
      <NavHeader
        title={t('notifications.title')}
        left={<NavBackButton onPress={() => router.back()} phLabel="notifications_back" />}
        right={<TextButton tone="accent" label={t('notifications.markAll')} onPress={() => void readAll()} />}
      />

      <ScrollView contentContainerStyle={styles.body} onMomentumScrollEnd={() => void loadMore()}>
        {!pushEnabled && (
          <View style={styles.pushOff}>
            <Feather name="bell-off" size={16} color={palette.amber} />
            <Text style={styles.pushOffText}>{toggleOffNotice(pushEnabled)}</Text>
          </View>
        )}
        {groups === null && !error && <SkeletonRows count={6} card={false} style={styles.skeletonFlush} />}
        {!!error && <InlineError message={error} onRetry={() => void load()} />}
        {groups !== null && groups.length === 0 && !error && (
          <InlineEmpty title={t('notifications.empty')} description={t('notifications.emptyBody')} />
        )}
        <AdSlot slot="notifications_top" />

        <View>
          {groups?.map((group, i) => (
            <Pressable
              key={group.group_key}
              style={[styles.row, i > 0 && styles.divider]}
              onPress={() => void open(group)}
              accessibilityRole="button">
              {/* 알림함은 모든 알림에 민트 기본 얼굴(DESIGN-SYSTEM 「의도된 차이」). */}
              <DefaultAvatar size={40} radius={20} />
              <View style={styles.rowBody}>
                <Text style={[styles.rowText, !group.read && styles.rowTextUnread]} numberOfLines={2}>
                  {groupLabel(group)}
                </Text>
                <Text style={styles.rowMeta}>{relativeDayLabel(group.latest_at)}</Text>
              </View>
              {!group.read && <View style={styles.dot} />}
            </Pressable>
          ))}
        </View>

        {groups !== null && groups.length > 0 && <Text style={styles.keep}>{t('notifications.keep')}</Text>}
      </ScrollView>
      {dialog}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  skeletonFlush: { paddingHorizontal: 0 },
  safe: { flex: 1, backgroundColor: palette.bg },
  body: { paddingHorizontal: space.gutter, paddingTop: space[2], paddingBottom: space[10], gap: space[2] },
  pushOff: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    paddingVertical: space[3],
    paddingHorizontal: space[4],
    borderRadius: radius.md,
    backgroundColor: palette.amberSoft,
  },
  pushOffText: { flex: 1, ...type.captionBold, color: palette.amber },
  row: { minHeight: 80, flexDirection: 'row', alignItems: 'center', gap: space[3] },
  divider: { borderTopWidth: 1, borderTopColor: palette.border },
  rowBody: { flex: 1, gap: 2 },
  rowText: { ...type.body1, color: palette.text },
  rowTextUnread: type.body1Bold,
  rowMeta: { ...type.caption, color: palette.textMeta },
  dot: { width: 8, height: 8, borderRadius: radius.full, backgroundColor: palette.blue },
  keep: { ...type.caption, color: palette.textMeta, textAlign: 'center', paddingVertical: space[2] },
});
