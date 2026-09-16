import Feather from '@expo/vector-icons/Feather';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { palette } from '@/constants/palette';
import { logEvent } from '@/lib/analytics';
import { MY_VIDEOS, PERF_IMAGES, SAVED_VIDEOS, type MockSavedVideo } from '@/lib/challenge-mock';
import { translate as t } from '@/lib/i18n';

/**
 * A15.5 저장한 영상 — 내 영상 / 저장한 영상 두 탭, 2열 그리드. 프로필의 "저장한 영상"과
 * 챌린지 탭의 "내 챌린지" 칩이 온다(tab 파라미터로 첫 탭을 고른다).
 * 예시 데이터(challenge-mock) — 북마크 해제는 이 화면 안에서만 반영된다.
 */
export default function SavedVideosScreen() {
  const router = useRouter();
  const { tab: initialTab } = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<'mine' | 'saved'>(initialTab === 'mine' ? 'mine' : 'saved');
  const [removed, setRemoved] = useState<Record<string, boolean>>({});

  const source = tab === 'mine' ? MY_VIDEOS : SAVED_VIDEOS;
  const items = source.filter((v) => !removed[v.id]);

  const open = (v: MockSavedVideo) => {
    logEvent('saved_video_open', { id: v.id, tab });
    router.push({ pathname: '/challenge-play', params: { name: v.name, line: v.line } });
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
            ['mine', t('savedVideos.tabMine', { count: MY_VIDEOS.length })],
            ['saved', t('savedVideos.tabSaved', { count: SAVED_VIDEOS.length })],
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
        {items.length === 0 ? (
          <Text style={styles.empty}>{t('savedVideos.empty')}</Text>
        ) : (
          <View style={styles.grid}>
            {items.map((v) => (
              <Pressable key={v.id} style={styles.cell} onPress={() => open(v)} accessibilityRole="button">
                <View style={styles.thumb}>
                  <Image source={PERF_IMAGES[v.img]} style={StyleSheet.absoluteFill} resizeMode="cover" />
                  <View style={styles.thumbScrim} />
                  {tab === 'saved' && (
                    <Pressable
                      style={styles.bookmark}
                      hitSlop={6}
                      onPress={() => setRemoved((r) => ({ ...r, [v.id]: true }))}
                      accessibilityRole="button">
                      <Feather name="bookmark" size={14} color="#FFD84D" />
                    </Pressable>
                  )}
                  <View style={styles.thumbFooter}>
                    <Text style={styles.thumbName}>{v.name}</Text>
                    <View style={styles.likeChip}>
                      <Feather name="heart" size={11} color="#FFFFFF" />
                      <Text style={styles.likeText}>{v.likes}</Text>
                    </View>
                  </View>
                </View>
                <Text style={styles.cellLine} numberOfLines={1}>“{v.line}”</Text>
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
