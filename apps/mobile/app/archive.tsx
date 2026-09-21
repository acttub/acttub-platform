import Feather from '@expo/vector-icons/Feather';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { palette } from '@/constants/palette';
import { logEvent } from '@/lib/analytics';
import { api } from '@/lib/api';
import { formatClipDuration, relativeDayLabel } from '@/lib/archive-format';
import { useAuth } from '@/lib/auth';
import { translate as t } from '@/lib/i18n';
import { mergeLibrary, statusLabel, type LibraryItem } from '@/lib/library/library-view';
import { onLibraryChange, pendingLibraryUploads, takeDiscardedCount } from '@/lib/library/library-runner';
import type { Video, VideoFilter } from '@/lib/library/types';
import { videoErrorMessage } from '@/lib/library/video-checks';
import type { QueuedVideo } from '@/lib/library/upload-queue';

/**
 * A2.2 보관함(practice.library) — 내 영상(서버 videos)을 최신 저장순으로. 필터는 전체·최근 7일·즐겨찾기이고, 아직
 * 확정되지 않은 촬영본(업로드 대기 큐)은 맨 위에 "기기에 저장 · 업로드 대기"로 보인다. 비어 있으면 예시 영상을 섞지
 * 않고 빈 상태를 보여 준다. 프로필 "보관한 영상 확인"과 기본 촬영 완료가 온다.
 */
const FILTERS: { key: VideoFilter; label: string }[] = [
  { key: 'all', label: t('archive.filterAll') },
  { key: 'recent7', label: t('archive.filterWeek') },
  { key: 'favorite', label: t('archive.filterFav') },
];

export default function ArchiveScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const owner = user?.id ?? null;
  const [filter, setFilter] = useState<VideoFilter>('all');
  const [videos, setVideos] = useState<Video[] | null>(null);
  const [pending, setPending] = useState<QueuedVideo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const [list, queued] = await Promise.all([
      api.listVideos(filter).catch((e: unknown) => {
        setError(videoErrorMessage(e));
        return null;
      }),
      owner ? pendingLibraryUploads(owner) : Promise.resolve([]),
    ]);
    if (list) setVideos(list.videos);
    setPending(queued);
    const discarded = takeDiscardedCount();
    if (discarded > 0) setNotice(t('archive.discardedNotice', { count: discarded }));
  }, [filter, owner]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  useEffect(() => onLibraryChange(() => void load()), [load]);

  const items = useMemo<LibraryItem[]>(
    () => mergeLibrary({ videos: videos ?? [], pending, filter, now: Date.now() }),
    [videos, pending, filter],
  );

  const open = (item: LibraryItem) => {
    logEvent('archive_open', { id: item.id, kind: item.kind });
    router.push({ pathname: '/archive-detail', params: item.kind === 'video' ? { id: item.id } : { pending: item.id } });
  };
  const toggleFav = async (item: LibraryItem) => {
    if (item.kind !== 'video') return;
    setVideos((list) => (list ?? []).map((v) => (v.id === item.id ? { ...v, favorite: !v.favorite } : v)));
    try {
      await api.setVideoFavorite(item.id, !item.video.favorite);
    } catch {
      void load();
    }
  };

  const total = (videos?.length ?? 0) + pending.length;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('common.back')}>
          <Feather name="chevron-left" size={26} color={palette.text} />
        </Pressable>
        <View style={styles.flex}>
          <Text style={styles.title}>{t('archive.title')}</Text>
          <Text style={styles.subtitle}>
            {t('archive.subtitle', { count: total })}
            {pending.length > 0 ? ` · ${t('archive.pendingCount', { count: pending.length })}` : ''}
          </Text>
        </View>
      </View>

      <View style={styles.filters}>
        {FILTERS.map((f) => (
          <Pressable
            key={f.key}
            style={[styles.chip, filter === f.key && styles.chipOn]}
            onPress={() => setFilter(f.key)}
            accessibilityRole="button"
            accessibilityState={{ selected: filter === f.key }}>
            <Text style={[styles.chipText, filter === f.key && styles.chipTextOn]}>{f.label}</Text>
          </Pressable>
        ))}
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {notice && (
          <Pressable style={styles.notice} onPress={() => setNotice(null)}>
            <Text style={styles.noticeText}>{notice}</Text>
          </Pressable>
        )}
        {error && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{t('archive.loadFail')}</Text>
            <Pressable onPress={() => void load()}>
              <Text style={styles.retry}>{t('common.retry')}</Text>
            </Pressable>
          </View>
        )}
        {videos === null && !error ? (
          <ActivityIndicator color={palette.blue} style={{ marginTop: 48 }} />
        ) : items.length === 0 ? (
          <View style={styles.empty}>
            <Feather name="film" size={34} color={palette.checkOff} />
            <Text style={styles.emptyTitle}>{t('archive.emptyTitle')}</Text>
            <Text style={styles.emptySub}>{t('archive.emptySub')}</Text>
          </View>
        ) : (
          <View style={styles.grid}>
            {items.map((item) => (
              <Pressable key={item.key} style={styles.cell} onPress={() => open(item)} accessibilityRole="button">
                <View style={[styles.thumb, item.kind === 'pending' && styles.thumbPending]}>
                  {item.kind === 'video' && (
                    <Pressable style={styles.star} hitSlop={6} onPress={() => void toggleFav(item)} accessibilityRole="button">
                      <Feather name="star" size={16} color={item.favorite ? '#F5B324' : 'rgba(255,255,255,0.7)'} />
                    </Pressable>
                  )}
                  {item.durationMs !== null && (
                    <View style={styles.durationChip}>
                      <Text style={styles.durationText}>{formatClipDuration(Math.round(item.durationMs / 1000))}</Text>
                    </View>
                  )}
                  <View style={styles.playBtn}>
                    <Feather name={item.kind === 'pending' ? 'upload-cloud' : 'play'} size={16} color="#FFFFFF" />
                  </View>
                </View>
                <Text style={styles.cellLabel}>{relativeDayLabel(new Date(item.createdAt).toISOString())}</Text>
                <Text style={[styles.cellStatus, item.kind === 'pending' && styles.cellStatusPending]} numberOfLines={1}>
                  {statusLabel(item)}
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
  safe: { flex: 1, backgroundColor: palette.bg },
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8 },
  title: { fontSize: 20, fontWeight: '800', color: palette.text },
  subtitle: { fontSize: 12, color: palette.textFaint, marginTop: 2 },
  filters: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginTop: 6 },
  chip: { borderRadius: 999, borderWidth: 1, borderColor: palette.border, paddingHorizontal: 14, paddingVertical: 7 },
  chipOn: { backgroundColor: palette.text, borderColor: palette.text },
  chipText: { fontSize: 13, fontWeight: '700', color: palette.textDim },
  chipTextOn: { color: '#FFFFFF' },
  body: { padding: 16, paddingBottom: 40, gap: 12 },
  notice: { backgroundColor: palette.amberSoft, borderRadius: 12, padding: 12 },
  noticeText: { color: palette.amber, fontFamily: 'Pretendard', fontSize: 13 },
  errorBox: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: palette.dangerSoft, borderRadius: 12, padding: 12 },
  errorText: { color: palette.danger, fontFamily: 'Pretendard', fontSize: 13 },
  retry: { color: palette.danger, fontFamily: 'Pretendard-SemiBold', fontSize: 13 },
  empty: { alignItems: 'center', gap: 8, paddingVertical: 60 },
  emptyTitle: { color: palette.text, fontFamily: 'Pretendard-Bold', fontSize: 17, marginTop: 6 },
  emptySub: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 13, textAlign: 'center', lineHeight: 20, paddingHorizontal: 20 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  cell: { width: '48%', gap: 4 },
  thumb: { aspectRatio: 0.72, borderRadius: 14, overflow: 'hidden', backgroundColor: palette.navy, alignItems: 'center', justifyContent: 'center' },
  thumbPending: { backgroundColor: palette.textDim },
  star: { position: 'absolute', top: 10, left: 10 },
  durationChip: { position: 'absolute', top: 10, right: 10, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  durationText: { fontSize: 11, fontWeight: '700', color: '#FFFFFF' },
  playBtn: { width: 38, height: 38, borderRadius: 19, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.7)', alignItems: 'center', justifyContent: 'center' },
  cellLabel: { fontSize: 12, color: palette.textFaint },
  cellStatus: { fontSize: 11, color: palette.textMuted, fontFamily: 'Pretendard-SemiBold' },
  cellStatusPending: { color: palette.amber },
});
