import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PartnerAvatar } from '@/components/messages/partner-avatar';
import { Badge } from '@/components/ui/badge';
import { NavBackButton, NavHeader } from '@/components/ui/nav-header';
import { SkeletonRows } from '@/components/ui/skeleton';
import { StatusScreen } from '@/components/ui/status-screen';
import { palette } from '@/constants/palette';
import { space, type } from '@/constants/tokens';
import { api } from '@/lib/api';
import { translate as t } from '@/lib/i18n';
import { listTime, unreadBadge, type DirectConversationSummary } from '@/lib/messages';

/**
 * 메시지 목록(SOMA-1039) — 프로필 탭 「메시지」 줄에서 들어온다. 마지막 메시지가 최근인 대화부터, 상대 사진·이름·미리보기·시각·
 * 안 읽은 수. 화면에 들어올 때마다 다시 받는다(대화방에서 돌아오면 읽은 수가 맞춰진다). 아래로 끝까지 내리면 더 받는다.
 */
export default function MessagesScreen() {
  const router = useRouter();
  const [rows, setRows] = useState<DirectConversationSummary[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const page = await api.listConversations();
      setRows(page.conversations);
      setCursor(page.next_cursor ?? null);
    } catch {
      setFailed(true);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const loadMore = async () => {
    if (!cursor) return;
    const page = await api.listConversations(cursor).catch(() => null);
    if (!page) return;
    setRows((prev) => {
      const have = new Set((prev ?? []).map((row) => row.id));
      return [...(prev ?? []), ...page.conversations.filter((row) => !have.has(row.id))];
    });
    setCursor(page.next_cursor ?? null);
  };

  const header = <NavHeader title={t('messages.title')} left={<NavBackButton onPress={() => router.back()} phLabel="messages_back" />} />;

  if (failed && !rows) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        {header}
        <StatusScreen title={t('messages.loadFail')} body={t('common.checkConnection')} primary={{ label: t('common.retry'), onPress: () => void load() }} />
      </SafeAreaView>
    );
  }

  if (rows && rows.length === 0) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        {header}
        <StatusScreen kind="empty" title={t('messages.emptyTitle')} body={t('messages.emptyBody')} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {header}
      <ScrollView contentContainerStyle={styles.body} onMomentumScrollEnd={() => void loadMore()}>
        {rows === null && <SkeletonRows count={6} card={false} style={styles.skeletonFlush} />}
        {rows?.map((row, i) => {
          const badge = unreadBadge(row.unread_count);
          return (
            <Pressable
              key={row.id}
              style={({ pressed }) => [styles.row, i > 0 && styles.divider, pressed && styles.pressed]}
              onPress={() => router.push({ pathname: '/messages/[id]', params: { id: row.id } })}
              accessibilityRole="button"
              accessibilityLabel={[row.partner.name, badge ? t('messages.unreadA11y', { count: row.unread_count }) : null].filter(Boolean).join(', ')}
              ph-label="messages_row">
              <PartnerAvatar uri={row.partner.photo_url} seed={row.partner.id} size={48} />
              <View style={styles.rowBody}>
                <View style={styles.rowHead}>
                  <Text style={[styles.name, row.partner.withdrawn && styles.nameLeft]} numberOfLines={1}>
                    {row.partner.name}
                  </Text>
                  <Text style={styles.time}>{listTime(row)}</Text>
                </View>
                <View style={styles.rowHead}>
                  <Text style={[styles.preview, badge && styles.previewUnread]} numberOfLines={1}>
                    {row.last_message?.preview.replace(/\s+/g, ' ') ?? ''}
                  </Text>
                  {badge ? <Badge label={badge} /> : null}
                </View>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  skeletonFlush: { paddingHorizontal: 0 },
  body: { paddingHorizontal: space.gutter, paddingTop: space[2], paddingBottom: space[10] },
  row: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: space[3] },
  divider: { borderTopWidth: 1, borderTopColor: palette.border },
  pressed: { opacity: 0.6 },
  rowBody: { flex: 1, minWidth: 0, gap: 2 },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  name: { ...type.body1Bold, color: palette.text, flex: 1 },
  nameLeft: { color: palette.textMeta },
  time: { ...type.caption, color: palette.textMeta },
  preview: { ...type.body2, color: palette.textSub, flex: 1 },
  previewUnread: { color: palette.text },
});
