import Feather from '@expo/vector-icons/Feather';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  Share,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAppDialog } from '@/components/app-dialog';
import { ChallengeCommentsSheet } from '@/components/challenge-comments-sheet';
import { ChallengeReportSheet } from '@/components/challenge-report-sheet';
import { palette } from '@/constants/palette';
import { logEvent } from '@/lib/analytics';
import { api } from '@/lib/api';
import { avatarLetter, browseFailure, browseFailureMessage, isEnded, rankEntries } from '@/lib/challenge/browse';
import type { ChallengeDetail, EntryCard } from '@/lib/challenge/types';
import { createViewTracker, VIEW_THRESHOLD_MS } from '@/lib/challenge/views';
import { translate as t } from '@/lib/i18n';
import { newRequestId } from '@/lib/request-id';

/**
 * A15 챌린지 피드 — 고른 챌린지 **안에서만** 참여작을 위아래로 넘겨 본다.
 *
 * 진입한 참여작부터 상세와 같은 순서(좋아요순)로 이어지고 끝에서 종료 안내를 보여 준다. 여러
 * 챌린지를 섞는 전체 피드는 없다. 20개씩 커서로 이어 받는다. 플레이어는 하나만 두고 활성
 * 페이지에서만 그린다. 조회수는 3초 이상 재생된 사건마다 한 번 보내고(본인 재생·미리 불러오기·
 * 자동 반복은 세지 않는다) 실패해도 재생을 막지 않는다. 반응(좋아요·저장·댓글·신고·차단)은 CM3 다.
 */
export default function ChallengePlayScreen() {
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const { alert, dialog } = useAppDialog();
  const { id, entryId } = useLocalSearchParams<{ id?: string; entryId?: string }>();
  const [challenge, setChallenge] = useState<ChallengeDetail | null>(null);
  const [entries, setEntries] = useState<EntryCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [atEnd, setAtEnd] = useState(false);
  const [playing, setPlaying] = useState(true);
  const [liked, setLiked] = useState<Record<string, boolean>>({});
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const listRef = useRef<FlatList<EntryCard>>(null);

  const player = useVideoPlayer(null, (p) => {
    p.loop = true;
    p.muted = true;
  });

  /** 조회수 사건 — 한 재생에 한 번, 실패는 삼킨다. */
  const viewTracker = useRef(
    createViewTracker({
      send: (entry, eventId) => api.recordEntryView(entry, eventId),
      newEventId: newRequestId,
    }),
  ).current;

  useEffect(() => {
    if (!id) return;
    let alive = true;
    void Promise.all([api.getChallenge(id), api.listChallengeEntries(id, { sort: 'likes', fromEntry: entryId })])
      .then(([detail, list]) => {
        if (!alive) return;
        setChallenge(detail);
        setEntries(rankEntries(list.entries, 'likes'));
        setCursor(list.next_cursor);
      })
      .catch((e) => {
        if (!alive) return;
        setEntries([]);
        setError(browseFailureMessage(browseFailure(e)));
      });
    return () => {
      alive = false;
    };
  }, [entryId, id]);

  // 페이지가 바뀌면 그 참여작의 영상으로 갈아끼운다.
  useEffect(() => {
    const entry = entries?.[active];
    if (!entry?.playback_url) return;
    player.replace(entry.playback_url);
    player.play();
    setPlaying(true);
    logEvent('challenge_swipe', { index: active });
  }, [active, entries, player]);

  /** 다음 20개를 이어 받는다. 정렬 기준이 바뀌면(410) 처음부터 다시 읽는다. */
  const loadMore = useCallback(async () => {
    if (!id || !cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const list = await api.listChallengeEntries(id, { sort: 'likes', cursor });
      setEntries((prev) => [...(prev ?? []), ...rankEntries(list.entries, 'likes')]);
      setCursor(list.next_cursor);
    } catch (e) {
      if (browseFailure(e).kind === 'cursor_expired') {
        const fresh = await api.listChallengeEntries(id, { sort: 'likes' }).catch(() => null);
        if (fresh) {
          setEntries(rankEntries(fresh.entries, 'likes'));
          setCursor(fresh.next_cursor);
        }
      }
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, id, loadingMore]);

  // 3초 이상 본 재생만 조회수가 된다. 자동 반복으로 되감긴 뒤는 같은 재생으로 다시 세지 않는다.
  useEffect(() => {
    const entry = entries?.[active];
    if (!entry || !playing) return;
    const startedAt = Date.now();
    const timer = setInterval(() => {
      void viewTracker.onProgress(entry.id, {
        elapsedMs: Date.now() - startedAt,
        isOwn: Boolean(entry.is_mine),
        isPreload: false,
        isRepeat: player.currentTime < VIEW_THRESHOLD_MS / 1000 && Date.now() - startedAt > VIEW_THRESHOLD_MS,
      });
    }, 1_000);
    return () => clearInterval(timer);
  }, [active, entries, player, playing, viewTracker]);

  const onMomentumEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const next = Math.round(e.nativeEvent.contentOffset.y / height);
      const total = entries?.length ?? 0;
      if (next !== active && next >= 0 && next < total) {
        viewTracker.leave(entries?.[active]?.id ?? '');
        setActive(next);
      }
      // 끝에 닿으면 다음 20개를 받고, 더 없으면 종료 안내를 보인다.
      if (next >= total - 2) {
        if (cursor) void loadMore();
        else if (next === total - 1) setAtEnd(true);
      }
    },
    [active, cursor, entries, height, loadMore, viewTracker],
  );

  const togglePlay = () => {
    if (playing) player.pause();
    else player.play();
    setPlaying((v) => !v);
  };

  const perform = () => {
    if (!challenge) return;
    logEvent('challenge_perform_tap', { id: challenge.id });
    router.push({
      pathname: '/record-video',
      params: { mode: 'challenge', challengeId: challenge.id, line: challenge.line, work: challenge.work },
    });
  };
  const share = (entry: EntryCard) => {
    logEvent('challenge_share', { id: entry.id });
    void Share.share({
      message: t('profileTab.shareText', { name: entry.author.name, line: challenge?.line ?? '' }),
    }).catch(() => {});
  };
  const report = (reason: string) => {
    setReportOpen(false);
    logEvent('challenge_report', { reason });
    void alert({ title: t('videoReport.doneTitle'), message: t('videoReport.doneMessage'), confirmLabel: t('common.confirm') });
  };

  const renderItem = ({ item, index }: { item: EntryCard; index: number }) => {
    const isActive = index === active;
    const isLiked = liked[item.id] ?? item.liked;
    return (
      <View style={{ width, height }}>
        {isActive && item.playback_url && (
          <VideoView style={StyleSheet.absoluteFill} player={player} contentFit="cover" nativeControls={false} />
        )}
        <Pressable style={StyleSheet.absoluteFill} onPress={togglePlay} accessibilityRole="button">
          {isActive && !playing && (
            <View style={styles.pauseCenter}>
              <Feather name="play" size={40} color="rgba(255,255,255,0.9)" />
            </View>
          )}
        </Pressable>
        <View style={styles.scrimTop} pointerEvents="none" />
        <View style={styles.scrimBottom} pointerEvents="none" />

        <SafeAreaView style={styles.overlay} edges={['top', 'bottom']} pointerEvents="box-none">
          <View style={styles.top}>
            <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button">
              <Feather name="x" size={26} color="#FFFFFF" />
            </Pressable>
            <View style={styles.author}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{avatarLetter(item.author.name)}</Text>
              </View>
              <Text style={styles.authorName}>{item.author.name}</Text>
            </View>
            <Pressable onPress={() => setReportOpen(true)} hitSlop={10} accessibilityRole="button">
              <Feather name="more-horizontal" size={24} color="#FFFFFF" />
            </Pressable>
          </View>

          <View style={styles.flex} pointerEvents="none" />

          <View style={styles.bottom}>
            <Text style={styles.storyLabel}>
              {index + 1} / {entries?.length ?? 0}
            </Text>
            <Text style={styles.line}>“{challenge?.line ?? ''}”</Text>
            <Text style={styles.work}>{challenge?.work ?? ''}</Text>
            {!!item.caption && <Text style={styles.work}>{item.caption}</Text>}

            <View style={styles.actions}>
              <Pressable
                style={styles.action}
                onPress={() => setLiked((prev) => ({ ...prev, [item.id]: !isLiked }))}
                accessibilityRole="button">
                <Feather name="heart" size={22} color={isLiked ? palette.danger : '#FFFFFF'} />
                <Text style={styles.actionText}>{item.like_count + (isLiked && !item.liked ? 1 : 0)}</Text>
              </Pressable>
              <Pressable style={styles.action} onPress={() => setCommentsOpen(true)} accessibilityRole="button">
                <Feather name="message-circle" size={22} color="#FFFFFF" />
                <Text style={styles.actionText}>{item.comment_count}</Text>
              </Pressable>
              <Pressable style={styles.action} onPress={() => share(item)} accessibilityRole="button">
                <Feather name="share-2" size={22} color="#FFFFFF" />
              </Pressable>
            </View>

            {challenge && !isEnded(challenge) && (
              <Pressable
                style={({ pressed }) => [styles.performBtn, pressed && styles.pressed]}
                onPress={perform}
                accessibilityRole="button">
                <Feather name="video" size={16} color="#FFFFFF" />
                <Text style={styles.performText}>{t('challenges.performCta')}</Text>
              </Pressable>
            )}
          </View>
        </SafeAreaView>
      </View>
    );
  };

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ headerShown: false }} />
      {entries === null && !error && <ActivityIndicator color="#FFFFFF" style={styles.loading} />}
      {!!error && <Text style={styles.error}>{error}</Text>}
      {entries !== null && entries.length === 0 && !error && (
        <SafeAreaView style={styles.emptyWrap} edges={['top', 'bottom']}>
          <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button" style={styles.emptyClose}>
            <Feather name="x" size={26} color="#FFFFFF" />
          </Pressable>
          <Text style={styles.line}>“{challenge?.line ?? ''}”</Text>
          <Text style={styles.empty}>{t('challenges.emptyEntries')}</Text>
          {challenge && !isEnded(challenge) && (
            <Pressable style={styles.performBtn} onPress={perform} accessibilityRole="button">
              <Feather name="video" size={16} color="#FFFFFF" />
              <Text style={styles.performText}>{t('challenges.performCta')}</Text>
            </Pressable>
          )}
        </SafeAreaView>
      )}
      {entries !== null && entries.length > 0 && (
        <FlatList
          ref={listRef}
          data={entries}
          keyExtractor={(entry) => entry.id}
          renderItem={renderItem}
          pagingEnabled
          showsVerticalScrollIndicator={false}
          getItemLayout={(_, index) => ({ length: height, offset: height * index, index })}
          onMomentumScrollEnd={onMomentumEnd}
          extraData={{ active, playing, liked }}
        />
      )}
      {atEnd && (
        <View style={styles.endNotice} pointerEvents="none">
          <Text style={styles.endText}>{t('challenges.feedEnd')}</Text>
        </View>
      )}
      <ChallengeCommentsSheet visible={commentsOpen} onClose={() => setCommentsOpen(false)} />
      <ChallengeReportSheet visible={reportOpen} onClose={() => setReportOpen(false)} onPick={report} />
      {dialog}
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1 },
  endNotice: { position: 'absolute', left: 0, right: 0, bottom: 120, alignItems: 'center' },
  endText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  error: { color: '#FFFFFF', textAlign: 'center', marginTop: 80, paddingHorizontal: 24 },
  emptyWrap: { flex: 1, padding: 24, gap: 14, justifyContent: 'center' },
  emptyClose: { position: 'absolute', top: 16, left: 16 },
  empty: { color: 'rgba(255,255,255,0.8)', fontSize: 15, lineHeight: 24 },
  root: { flex: 1, backgroundColor: '#000000' },
  flex: { flex: 1 },
  pauseCenter: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scrimTop: { position: 'absolute', top: 0, left: 0, right: 0, height: 120, backgroundColor: 'rgba(0,0,0,0.35)' },
  scrimBottom: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 340, backgroundColor: 'rgba(0,0,0,0.45)' },
  overlay: { flex: 1, justifyContent: 'space-between' },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8 },
  author: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  authorName: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  avatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.25)', alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 14, fontWeight: '800', color: '#FFFFFF' },
  bottom: { paddingHorizontal: 20, paddingBottom: 16, gap: 10 },
  dots: { flexDirection: 'row', gap: 6, marginBottom: 2 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.35)' },
  dotOn: { width: 18, backgroundColor: '#FFFFFF' },
  storyLabel: { fontSize: 12, fontWeight: '800', color: 'rgba(255,255,255,0.8)' },
  line: { fontSize: 22, fontWeight: '800', color: '#FFFFFF', lineHeight: 30 },
  work: { fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.75)' },
  actions: { flexDirection: 'row', gap: 22, marginTop: 6 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  actionText: { fontSize: 14, fontWeight: '800', color: '#FFFFFF' },
  performBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: palette.blue,
    borderRadius: 14,
    paddingVertical: 15,
    marginTop: 6,
  },
  pressed: { opacity: 0.85 },
  performText: { fontSize: 15, fontWeight: '800', color: '#FFFFFF' },
});
