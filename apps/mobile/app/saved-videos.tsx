import Feather from '@expo/vector-icons/Feather';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AdSlot } from '@/components/ad-slot';
import { InlineEmpty } from '@/components/ui/inline-empty';
import { InlineError, InlineErrorLine } from '@/components/ui/inline-error';
import { NavBackButton, NavHeader } from '@/components/ui/nav-header';
import { SkeletonCards } from '@/components/ui/skeleton';
import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';
import { logEvent } from '@/lib/analytics';
import { api } from '@/lib/api';
import { browseFailure, browseFailureMessage } from '@/lib/challenge/browse';
import { reactFailure, reactFailureMessage } from '@/lib/challenge/react';
import type { EntryCard } from '@/lib/challenge/types';
import { translate as t } from '@/lib/i18n';

/**
 * A15.5 저장한 영상 — 내 영상 / 저장한 영상 두 탭, 2열 그리드.
 *
 * 저장은 다시 찾아볼 개인 북마크다(challenge.react). 저장한 참여작이 비공개·운영 숨김이 되면
 * 목록에서 빠지고 행은 남으며(다시 공개되면 돌아온다) 참여작이 삭제되면 행도 사라진다.
 * 저장은 랭킹·작성자 알림에 반영하지 않는다. 내 참여작의 분류는 P03(challenge-entries)에 있다.
 */
/** 저장한 참여작과 내 참여작이 함께 쓰는 칸 — NEW 는 최신순 목록에서만 뜻이 있다. */
type SavedItem = Omit<EntryCard, 'is_new'>;

export default function SavedVideosScreen() {
  const router = useRouter();
  const { tab: initialTab } = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<'mine' | 'saved'>(initialTab === 'mine' ? 'mine' : 'saved');
  const [saved, setSaved] = useState<SavedItem[] | null>(null);
  const [mine, setMine] = useState<SavedItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unsaveError, setUnsaveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [savedList, myList] = await Promise.all([api.listSavedEntries(), api.listMyChallengeEntries()]);
      setSaved(savedList.entries);
      setMine(myList.entries);
    } catch (e) {
      setSaved([]);
      setMine([]);
      const failure = browseFailure(e);
      setError(failure.kind === 'other' ? t('savedVideos.loadFail') : browseFailureMessage(failure));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const items = tab === 'mine' ? mine : saved;

  /** 저장 풀기 — 멱등이라 두 번 눌러도 문제가 없다. */
  const unsave = async (entry: SavedItem) => {
    setSaved((prev) => (prev ?? []).filter((e) => e.id !== entry.id));
    setUnsaveError(null);
    try {
      await api.saveEntry(entry.id, false);
    } catch (e) {
      setUnsaveError(reactFailureMessage(reactFailure(e)));
      void load();
    }
  };

  const open = (entry: SavedItem) => {
    logEvent('saved_video_open', { id: entry.id, tab });
    router.push({ pathname: '/challenge-play', params: { entryId: entry.id } });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <NavHeader title={t('savedVideos.title')} left={<NavBackButton phLabel="saved_videos_back" onPress={() => router.back()} />} />

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
        <AdSlot slot="saved_videos_top" />
        <Text style={styles.hint}>{t(tab === 'mine' ? 'savedVideos.hintMine' : 'savedVideos.hintSaved')}</Text>
        {!!error && <InlineError message={error} onRetry={() => void load()} />}
        {!!unsaveError && <InlineErrorLine message={unsaveError} />}
        {items === null && !error && <SkeletonCards count={4} columns={2} aspectRatio={0.78} style={styles.skeleton} />}
        {items !== null && items.length === 0 && !error ? (
          <InlineEmpty
            title={t(tab === 'mine' ? 'savedVideos.emptyMineTitle' : 'savedVideos.emptyTitle')}
            description={t(tab === 'mine' ? 'savedVideos.emptyMineBody' : 'savedVideos.emptyBody')}
          />
        ) : (
          <View style={styles.grid}>
            {items?.map((entry) => (
              <Pressable key={entry.id} style={styles.cell} onPress={() => open(entry)} accessibilityRole="button">
                <View style={styles.thumb}>
                  {tab === 'saved' && (
                    <Pressable
                      style={styles.bookmark}
                      hitSlop={6}
                      onPress={() => void unsave(entry)}
                      accessibilityRole="button"
                      accessibilityLabel={t('react.menuSave')}>
                      <Feather name="bookmark" size={14} color={palette.onAccent} />
                    </Pressable>
                  )}
                </View>
                {!!entry.caption && (
                  <Text style={styles.caption} numberOfLines={1}>
                    {entry.caption}
                  </Text>
                )}
                <View style={styles.metaRow}>
                  <Ionicons name="heart-outline" size={12} color={palette.danger} />
                  <Text style={styles.meta} numberOfLines={1}>
                    {entry.like_count} · {entry.author.name}
                  </Text>
                </View>
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  tabs: {
    flexDirection: 'row',
    gap: space[1],
    marginHorizontal: space.gutter,
    backgroundColor: palette.bgSoft,
    borderRadius: radius.md,
    padding: space[1],
  },
  tab: { flex: 1, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
  tabOn: { backgroundColor: palette.bg },
  tabText: { ...type.body2Bold, color: palette.textMeta },
  tabTextOn: { color: palette.text },
  body: { paddingHorizontal: space.gutter, paddingTop: space[4], paddingBottom: space[10], gap: space[3] },
  hint: { ...type.caption, color: palette.textMeta },
  skeleton: { paddingHorizontal: 0 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space[3] },
  cell: { width: '47%', flexGrow: 1, gap: space[1] },
  thumb: { aspectRatio: 0.8, borderRadius: radius.md, overflow: 'hidden', backgroundColor: palette.bgSoft },
  bookmark: {
    position: 'absolute',
    top: space[2],
    right: space[2],
    width: 28,
    height: 28,
    borderRadius: radius.full,
    backgroundColor: palette.scrim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  caption: { ...type.captionBold, color: palette.text, marginTop: space[1] },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  meta: { flexShrink: 1, ...type.micro, color: palette.textMeta },
});
