import Feather from '@expo/vector-icons/Feather';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { palette } from '@/constants/palette';
import { logEvent } from '@/lib/analytics';
import { api } from '@/lib/api';
import { avatarLetter, browseFailure, browseFailureMessage } from '@/lib/challenge/browse';
import type { EntryCard } from '@/lib/challenge/types';
import { translate as t } from '@/lib/i18n';

/**
 * A15.5 저장한 영상 — 내 영상 / 저장한 영상 두 탭, 2열 그리드.
 *
 * 예시 데이터를 걷어내고 서버에서 읽는다. 저장 해제·좋아요 같은 반응은 CM3 가, 내 참여작의
 * 분류(공개·비공개·확인 중)는 CM2(P03)가 잇는다.
 */
export default function SavedVideosScreen() {
  const router = useRouter();
  const { tab: initialTab } = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<'mine' | 'saved'>(initialTab === 'mine' ? 'mine' : 'saved');
  const [saved, setSaved] = useState<EntryCard[] | null>(null);
  const [mine, setMine] = useState<EntryCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [savedList, myList] = await Promise.all([api.listSavedEntries(), api.listMyChallengeEntries()]);
      setSaved(savedList.entries);
      setMine(myList.entries);
    } catch (e) {
      setSaved([]);
      setMine([]);
      setError(browseFailureMessage(browseFailure(e)));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const items = tab === 'mine' ? mine : saved;

  const open = (entry: EntryCard) => {
    logEvent('saved_video_open', { id: entry.id, tab });
    router.push({ pathname: '/challenge-play', params: { entryId: entry.id } });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('common.back')}>
          <Feather name="chevron-left" size={26} color={palette.text} />
        </Pressable>
        <Text style={styles.title}>{t('savedVideos.title')}</Text>
      </View>

      <View style={styles.tabs}>
        {(
          [
            ['mine', t('savedVideos.tabMine', { count: mine?.length ?? 0 })],
            ['saved', t('savedVideos.tabSaved', { count: saved?.length ?? 0 })],
          ] as const
        ).map(([key, label]) => (
          <Pressable
            key={key}
            style={[styles.tab, tab === key && styles.tabOn]}
            onPress={() => setTab(key)}
            accessibilityRole="button"
            accessibilityState={{ selected: tab === key }}>
            <Text style={[styles.tabText, tab === key && styles.tabTextOn]}>{label}</Text>
          </Pressable>
        ))}
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.hint}>{t(tab === 'mine' ? 'savedVideos.hintMine' : 'savedVideos.hintSaved')}</Text>
        {!!error && <Text style={styles.empty}>{error}</Text>}
        {items === null && !error && <ActivityIndicator color={palette.blue} style={{ marginTop: 32 }} />}
        {items !== null && items.length === 0 && !error ? (
          <Text style={styles.empty}>{t('savedVideos.empty')}</Text>
        ) : (
          <View style={styles.grid}>
            {items?.map((entry) => (
              <Pressable key={entry.id} style={styles.cell} onPress={() => open(entry)} accessibilityRole="button">
                <View style={styles.thumb}>
                  <View style={styles.thumbScrim} />
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{avatarLetter(entry.author.name)}</Text>
                  </View>
                  <View style={styles.thumbFooter}>
                    <Text style={styles.thumbName}>{entry.author.name}</Text>
                    <View style={styles.likeChip}>
                      <Feather name="heart" size={11} color="#FFFFFF" />
                      <Text style={styles.likeText}>{entry.like_count}</Text>
                    </View>
                  </View>
                </View>
                <Text style={styles.cellLine} numberOfLines={1}>
                  {entry.caption ?? ''}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 15, fontWeight: '900', color: '#FFFFFF' },
  safe: { flex: 1, backgroundColor: palette.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8 },
  title: { fontSize: 20, fontWeight: '800', color: palette.text },
  tabs: {
    flexDirection: 'row',
    marginHorizontal: 16,
    backgroundColor: palette.bgSoft,
    borderRadius: 12,
    padding: 4,
  },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 9 },
  tabOn: { backgroundColor: palette.card },
  tabText: { fontSize: 13.5, fontWeight: '700', color: palette.textFaint },
  tabTextOn: { color: palette.text },
  body: { padding: 16, paddingBottom: 40, gap: 12 },
  hint: { fontSize: 12.5, color: palette.textFaint },
  empty: { textAlign: 'center', color: palette.textDim, marginTop: 48 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  cell: { width: '48%', gap: 6 },
  thumb: { aspectRatio: 0.78, borderRadius: 14, overflow: 'hidden', backgroundColor: palette.navy },
  thumbImg: { width: '100%', height: '100%' },
  thumbScrim: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 60, backgroundColor: 'rgba(0,0,0,0.45)' },
  bookmark: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbFooter: {
    position: 'absolute',
    left: 10,
    right: 10,
    bottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  thumbName: { fontSize: 12.5, fontWeight: '800', color: '#FFFFFF' },
  likeChip: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  likeText: { fontSize: 11.5, fontWeight: '700', color: '#FFFFFF' },
  cellLine: { fontSize: 12.5, fontWeight: '600', color: palette.textDim },
});
