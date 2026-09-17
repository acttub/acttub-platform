import Feather from '@expo/vector-icons/Feather';
import { Stack, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { palette } from '@/constants/palette';
import { logEvent } from '@/lib/analytics';
import { formatClipDuration, relativeDayLabel } from '@/lib/archive-format';
import { ARCHIVE_VIDEOS, PERF_IMAGES, type MockArchiveVideo } from '@/lib/challenge-mock';
import { translate as t } from '@/lib/i18n';

type Filter = 'all' | 'week' | 'fav';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A2.2 보관함 — 촬영으로 기기에 남은 영상 그리드(전체/이번 주/즐겨찾기, 선택 모드).
 * 프로필 "보관한 영상 확인"과 촬영 완료 화면의 "보관함 보기"가 온다.
 * 지금은 예시 데이터 — 실제 촬영 결과를 여기 쌓는 건 로컬 저장이 붙을 때.
 */
export default function ArchiveScreen() {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>('all');
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [favs, setFavs] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(ARCHIVE_VIDEOS.map((v) => [v.id, v.favorite])),
  );

  const items = useMemo(() => {
    const since = Date.now() - 7 * DAY_MS;
    return ARCHIVE_VIDEOS.filter((v) =>
      filter === 'fav' ? favs[v.id] : filter === 'week' ? Date.parse(v.createdAt) >= since : true,
    );
  }, [filter, favs]);

  const open = (v: MockArchiveVideo) => {
    if (selecting) {
      setSelected((s) => ({ ...s, [v.id]: !s[v.id] }));
      return;
    }
    logEvent('archive_open', { id: v.id });
    router.push({ pathname: '/archive-detail', params: { id: v.id } });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('common.back')}>
          <Feather name="chevron-left" size={26} color={palette.text} />
        </Pressable>
        <View style={styles.flex}>
          <Text style={styles.title}>{t('archive.title')}</Text>
          <Text style={styles.subtitle}>{t('archive.subtitle', { count: ARCHIVE_VIDEOS.length })}</Text>
        </View>
        <Pressable
          onPress={() => {
            setSelecting((v) => !v);
            setSelected({});
          }}
          hitSlop={8}
          accessibilityRole="button">
          <Text style={styles.selectText}>{t(selecting ? 'archive.done' : 'archive.select')}</Text>
        </Pressable>
      </View>

      <View style={styles.filters}>
        {(
          [
            ['all', 'archive.filterAll'],
            ['week', 'archive.filterWeek'],
            ['fav', 'archive.filterFav'],
          ] as const
        ).map(([key, label]) => (
          <Pressable
            key={key}
            style={[styles.chip, filter === key && styles.chipOn]}
            onPress={() => setFilter(key)}
            accessibilityRole="button"
            accessibilityState={{ selected: filter === key }}>
            <Text style={[styles.chipText, filter === key && styles.chipTextOn]}>{t(label)}</Text>
          </Pressable>
        ))}
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {items.length === 0 ? (
          <Text style={styles.empty}>{t('archive.empty')}</Text>
        ) : (
          <View style={styles.grid}>
            {items.map((v) => (
              <Pressable key={v.id} style={styles.cell} onPress={() => open(v)} accessibilityRole="button">
                <View style={[styles.thumb, selecting && selected[v.id] && styles.thumbSelected]}>
                  <Image source={PERF_IMAGES[v.img]} style={[StyleSheet.absoluteFill, styles.thumbImg]} resizeMode="cover" />
                  <Pressable
                    style={styles.star}
                    hitSlop={6}
                    onPress={() => setFavs((f) => ({ ...f, [v.id]: !f[v.id] }))}
                    accessibilityRole="button">
                    <Feather name="star" size={16} color={favs[v.id] ? '#F5B324' : 'rgba(255,255,255,0.7)'} />
                  </Pressable>
                  <View style={styles.durationChip}>
                    <Text style={styles.durationText}>{formatClipDuration(v.duration)}</Text>
                  </View>
                  <View style={styles.playBtn}>
                    <Feather name="play" size={16} color="#FFFFFF" />
                  </View>
                  {selecting && (
                    <View style={[styles.check, selected[v.id] && styles.checkOn]}>
                      {selected[v.id] && <Feather name="check" size={12} color="#FFFFFF" />}
                    </View>
                  )}
                </View>
                <Text style={styles.cellLabel}>{relativeDayLabel(v.createdAt)}</Text>
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
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8 },
  title: { fontSize: 20, fontWeight: '800', color: palette.text },
  subtitle: { fontSize: 12, color: palette.textFaint, marginTop: 2 },
  selectText: { fontSize: 14, fontWeight: '700', color: palette.blue },
  filters: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginTop: 6 },
  chip: { borderRadius: 999, borderWidth: 1, borderColor: palette.border, paddingHorizontal: 14, paddingVertical: 7 },
  chipOn: { backgroundColor: palette.text, borderColor: palette.text },
  chipText: { fontSize: 13, fontWeight: '700', color: palette.textDim },
  chipTextOn: { color: '#FFFFFF' },
  body: { padding: 16, paddingBottom: 40 },
  empty: { textAlign: 'center', color: palette.textDim, marginTop: 48 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  cell: { width: '48%', gap: 6 },
  thumb: {
    aspectRatio: 0.72,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: palette.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbSelected: { borderWidth: 3, borderColor: palette.blue },
  thumbImg: { width: '100%', height: '100%', opacity: 0.35 },
  star: { position: 'absolute', top: 10, left: 10 },
  durationChip: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  durationText: { fontSize: 11, fontWeight: '700', color: '#FFFFFF' },
  playBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  check: {
    position: 'absolute',
    bottom: 10,
    right: 10,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: palette.blue, borderColor: palette.blue },
  cellLabel: { fontSize: 12, color: palette.textFaint },
});
