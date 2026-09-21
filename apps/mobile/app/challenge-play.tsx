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
import { translate as t } from '@/lib/i18n';

/**
 * A15 챌린지 피드 — 고른 챌린지 **안에서만** 참여작을 위아래로 넘겨 본다.
 *
 * 진입한 참여작부터 상세와 같은 순서(좋아요순)로 이어지고 끝에서 종료 안내를 보여 준다. 여러
 * 챌린지를 섞는 전체 피드는 없다. 플레이어는 하나만 두고 활성 페이지에서만 그린다.
 * 조회수 사건·반응(좋아요·저장·댓글·신고·차단)은 CM2·CM3 가 잇는다 — 여기서는 화면만 있다.
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
  const [playing, setPlaying] = useState(true);
  const [liked, setLiked] = useState<Record<string, boolean>>({});
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const listRef = useRef<FlatList<EntryCard>>(null);

  const player = useVideoPlayer(null, (p) => {
    p.loop = true;
    p.muted = true;
  });

  useEffect(() => {
    if (!id) return;
    let alive = true;
    void Promise.all([api.getChallenge(id), api.listChallengeEntries(id, { sort: 'likes', fromEntry: entryId })])
      .then(([detail, list]) => {
        if (!alive) return;
        setChallenge(detail);
        setEntries(rankEntries(list.entries, 'likes'));
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

  const onMomentumEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const next = Math.round(e.nativeEvent.contentOffset.y / height);
      if (next !== active && next >= 0 && next < (entries?.length ?? 0)) setActive(next);
    },
    [active, entries?.length, height],
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
      <ChallengeCommentsSheet visible={commentsOpen} onClose={() => setCommentsOpen(false)} />
      <ChallengeReportSheet visible={reportOpen} onClose={() => setReportOpen(false)} onPick={report} />
      {dialog}
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1 },
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
