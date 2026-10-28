import Feather from '@expo/vector-icons/Feather';
import { Stack, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { InlineEmpty } from '@/components/ui/inline-empty';
import { InlineError } from '@/components/ui/inline-error';
import { NavBackButton, NavHeader } from '@/components/ds/ui/nav-header';
import { SkeletonRows } from '@/components/ui/skeleton';
import { palette } from '@/constants/palette';
import { space, type } from '@/constants/tokens';
import { api } from '@/lib/api';
import { currentLanguage, dateLocale, translate as t } from '@/lib/i18n';
import { formatNoticeDate, rememberNotices, type Notice } from '@/lib/notices';

/**
 * 공지사항 목록(SOMA-919). 팝업으로 한 번 닫은 공지를 다시 볼 수 있다 — 지금 떠 있는 공지와 끝난 공지가 공지한 날 늦은 순이다.
 * 전체 화면이고, 받는 동안은 행 뼈대를 보인다. 한 줄을 누르면 상세 화면으로 간다.
 */
export default function NoticesScreen() {
  const router = useRouter();
  const [notices, setNotices] = useState<Notice[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    setNotices(null);
    try {
      const response = await api.getNotices({ platform: Platform.OS === 'ios' ? 'ios' : 'android', locale: currentLanguage() });
      rememberNotices(response.notices);
      setNotices(response.notices);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <NavHeader title={t('notices.title')} left={<NavBackButton onPress={() => router.back()} phLabel="notices_back" />} />
      {notices === null && !failed ? (
        <SkeletonRows count={6} avatar={false} card={false} />
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {failed ? <InlineError message={t('notices.loadFail')} onRetry={() => void load()} /> : null}
          {notices !== null && notices.length === 0 ? <InlineEmpty title={t('notices.empty')} /> : null}
          {notices?.map((notice, i) => (
            <Pressable
              key={notice.slug}
              onPress={() => router.push({ pathname: '/notice-detail', params: { slug: notice.slug } })}
              style={({ pressed }) => [styles.row, i > 0 && styles.divider, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={notice.title}>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle} numberOfLines={2}>{notice.title}</Text>
                <View style={styles.metaRow}>
                  <Text style={[styles.status, notice.live && styles.statusLive]}>{t(notice.live ? 'notices.live' : 'notices.ended')}</Text>
                  <Text style={styles.meta}>{formatNoticeDate(notice.published_at, dateLocale())}</Text>
                </View>
              </View>
              <Feather name="chevron-right" size={18} color={palette.iconFaint} />
            </Pressable>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  list: { paddingHorizontal: space.gutter, paddingBottom: space[6] },
  divider: { borderTopWidth: 1, borderTopColor: palette.border },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: space[3] },
  pressed: { opacity: 0.6 },
  rowText: { flex: 1, minWidth: 0, gap: space[1] },
  rowTitle: { ...type.body1Bold, color: palette.text },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  status: { ...type.captionBold, color: palette.textMeta },
  statusLive: { color: palette.blueDeep },
  meta: { ...type.caption, color: palette.textMeta },
});
