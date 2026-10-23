import Feather from '@expo/vector-icons/Feather';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
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
import { useEntryShare } from '@/components/entry-share-sheet';
import { palette } from '@/constants/palette';
import { logEvent } from '@/lib/analytics';
import { api } from '@/lib/api';
import { avatarLetter, browseFailure, browseFailureMessage, canPerform, isEnded, rankEntries } from '@/lib/challenge/browse';
import { blockFailureMessage, buildReportBody, canBlock, removeAuthored, reportDoneMessage, reportFailure, reportFailureMessage } from '@/lib/challenge/moderation';
import { commentCountAfter } from '@/lib/challenge/entry';
import { canReact, optimisticLike, optimisticSave, reactFailure, reactFailureMessage } from '@/lib/challenge/react';
import type { ChallengeDetail, EntryCard, ReportReason, ReportTarget } from '@/lib/challenge/types';
import { createViewTracker, VIEW_THRESHOLD_MS } from '@/lib/challenge/views';
import { useAuth } from '@/lib/auth';
import { translate as t } from '@/lib/i18n';
import { newRequestId } from '@/lib/request-id';
import { limitVideoBuffer } from '@/lib/video-memory';

/**
 * A15 챌린지 피드 — 고른 챌린지 **안에서만** 참여작을 위아래로 넘겨 본다.
 *
 * 진입한 참여작부터 상세와 같은 순서(좋아요순)로 이어지고 끝에서 종료 안내를 보여 준다. 여러
 * 챌린지를 섞는 전체 피드는 없다. 20개씩 커서로 이어 받는다. 플레이어는 하나만 두고 활성
 * 페이지에서만 그린다. 조회수는 3초 이상 재생된 사건마다 한 번 보내고(본인 재생·미리 불러오기·
 * 자동 반복은 세지 않는다) 실패해도 재생을 막지 않는다.
 *
 * 반응(challenge.react): 좋아요는 먼저 표시를 바꾸고 서버가 실패하면 되돌려 알린다. 저장·댓글도
 * 같은 자리에 있고 자기 참여작에는 좋아요·저장을 하지 않는다. 신고(A15.4)는 사유 다섯에 기타
 * 메모이고, 차단하면 그 사람의 참여작이 이 화면에서 바로 사라진다(상대에게 알리지 않는다).
 */
export default function ChallengePlayScreen() {
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const { alert, confirm, sheet, dialog } = useAppDialog();
  const { user } = useAuth();
  const { id, entryId } = useLocalSearchParams<{ id?: string; entryId?: string }>();
  const [challenge, setChallenge] = useState<ChallengeDetail | null>(null);
  const [entries, setEntries] = useState<EntryCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [atEnd, setAtEnd] = useState(false);
  const [playing, setPlaying] = useState(true);
  // 소리는 켠 채로 튼다 — 연기 영상은 대사가 반이다. 끄고 싶으면 위의 스피커로 끈다.
  const [muted, setMuted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [playFailed, setPlayFailed] = useState(false);
  /** 「다시 시도」를 누를 때마다 올라가 같은 참여작의 영상을 다시 받는다. */
  const [retryTick, setRetryTick] = useState(0);
  const [reportTarget, setReportTarget] = useState<{ type: ReportTarget; id: string } | null>(null);
  const listRef = useRef<FlatList<EntryCard>>(null);

  const focused = useIsFocused();
  const player = useVideoPlayer(null, (p) => {
    p.loop = true;
    limitVideoBuffer(p);
  });

  // 재생할 수 없는 영상(0.2초짜리 등)이면 무한 로딩 대신 안내한다.
  useEffect(() => {
    const sub = player.addListener('statusChange', ({ status }) => {
      if (status === 'error') setPlayFailed(true);
      else if (status === 'readyToPlay') setPlayFailed(false);
    });
    return () => sub.remove();
  }, [player]);

  useEffect(() => {
    player.muted = muted;
  }, [muted, player]);

  /** 조회수 사건 — 한 재생에 한 번, 실패는 삼킨다. */
  const viewTracker = useRef(
    createViewTracker({
      send: (entry, eventId) => api.recordEntryView(entry, eventId),
      newEventId: newRequestId,
    }),
  ).current;

  useEffect(() => {
    if (!id && !entryId) return;
    let alive = true;
    // 저장한 영상·내 영상에서는 챌린지 id 없이 참여작 id 만 넘어온다 — 참여작에서 챌린지를 알아낸다.
    // 내 비공개 참여작은 피드(공개 목록)에 없어 404 가 되므로 그 참여작 한 개만 보여 준다(SOMA-738).
    void (async () => {
      const own = entryId ? await api.getEntry(entryId).catch(() => null) : null;
      const challengeId = id ?? own?.challenge_id;
      if (!challengeId) throw Object.assign(new Error('not_found'), { status: 404 });
      const detail = await api.getChallenge(challengeId);
      try {
        const list = await api.listChallengeEntries(challengeId, { sort: 'likes', fromEntry: entryId });
        return { detail, list: rankEntries(list.entries, 'likes'), next: list.next_cursor };
      } catch (e) {
        if (own && browseFailure(e).kind === 'not_found') return { detail, list: [own as EntryCard], next: null };
        throw e;
      }
    })()
      .then(({ detail, list, next }) => {
        if (!alive) return;
        setChallenge(detail);
        setEntries(list);
        setCursor(next);
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

  // 보던 맨 끝 참여작을 신고로 빼면 보던 자리가 비므로 효과가 돌기 전에 남은 마지막 참여작으로 당긴다.
  if (entries?.length && active >= entries.length) setActive(entries.length - 1);

  // 페이지가 바뀌면 그 참여작의 영상으로 갈아끼운다.
  useEffect(() => {
    const entry = entries?.[active];
    setPlayFailed(!entry?.playback_url && entries !== null && entries.length > 0);
    if (!entry?.playback_url) return;
    // replaceAsync — replace 는 iOS 에서 영상을 주 스레드로 불러와 넘길 때 화면이 멈출 수 있다(SOMA-713).
    let alive = true;
    void player
      .replaceAsync(entry.playback_url)
      .then(() => {
        if (!alive) return;
        player.play();
        setPlaying(true);
      })
      .catch(() => alive && setPlayFailed(true));
    // 불러오기가 끝나지 않는 영상은 안내로 바꾼다.
    const timer = setTimeout(() => {
      if (alive && player.status !== 'readyToPlay') setPlayFailed(true);
    }, 15_000);
    logEvent('challenge_swipe', { index: active });
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [active, entries, player, retryTick]);

  // 위에 촬영 같은 다른 화면이 올라오면 영상을 내려놓아 메모리를 돌려주고, 돌아오면 보던 참여작을 다시 튼다(SOMA-699).
  useEffect(() => {
    if (focused) return;
    player.pause();
    void player.replaceAsync(null).catch(() => {});
    return () => {
      const entry = entries?.[active];
      if (!entry?.playback_url) return;
      // 가려진 채로 화면이 닫히면 플레이어가 먼저 풀려 있을 수 있다 — 그때는 다시 틀 필요가 없다.
      try {
        void player
          .replaceAsync(entry.playback_url)
          .then(() => {
            player.play();
            setPlaying(true);
          })
          .catch(() => {});
      } catch {}
    };
    // 가려진 동안 entries·active 는 바뀌지 않는다 — 돌아올 때 그때의 참여작을 다시 튼다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focused, player]);

  /** 다음 20개를 이어 받는다. 정렬 기준이 바뀌면(410) 처음부터 다시 읽는다. */
  const loadMore = useCallback(async () => {
    // 참여작 id 로만 들어오면 라우트에 챌린지 id 가 없다 — 불러온 챌린지의 id 로 이어 받는다.
    const challengeId = challenge?.id;
    if (!challengeId || !cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const list = await api.listChallengeEntries(challengeId, { sort: 'likes', cursor });
      setEntries((prev) => [...(prev ?? []), ...rankEntries(list.entries, 'likes')]);
      setCursor(list.next_cursor);
    } catch (e) {
      if (browseFailure(e).kind === 'cursor_expired') {
        const fresh = await api.listChallengeEntries(challengeId, { sort: 'likes' }).catch(() => null);
        if (fresh) {
          setEntries(rankEntries(fresh.entries, 'likes'));
          setCursor(fresh.next_cursor);
        }
      }
    } finally {
      setLoadingMore(false);
    }
  }, [challenge, cursor, loadingMore]);

  // 3초 이상 본 재생만 조회수가 된다. 자동 반복으로 되감긴 뒤는 같은 재생으로 다시 세지 않는다.
  useEffect(() => {
    const entry = entries?.[active];
    if (!entry || !playing) return;
    const startedAt = Date.now();
    const timer = setInterval(() => {
      void viewTracker.onProgress(entry.id, {
        elapsedMs: Date.now() - startedAt,
        isOwn: Boolean(entry.is_mine),
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
    if (!challenge || !canPerform(challenge)) return;
    logEvent('challenge_perform_tap', { id: challenge.id });
    router.push({
      pathname: '/record-video',
      params: { mode: 'challenge', challengeId: challenge.id, line: challenge.line, work: challenge.work },
    });
  };
  const entryShare = useEntryShare(challenge?.line ?? '', () =>
    void alert({ title: t('entryShare.title'), message: t('entryShare.none') }),
  );
  const share = (entry: EntryCard) => {
    logEvent('challenge_share', { id: entry.id });
    // 공유 시트(SOMA-819) — 내 참여작은 인스타 스토리·영상 저장, 공개 참여작은 딥링크(회원 앱에서 열면 노출 조건을 확인한 뒤 그 참여작부터 연다).
    entryShare.open(entry);
  };

  const patchEntry = (entryId: string, patch: Partial<EntryCard>) =>
    setEntries((prev) => (prev ?? []).map((e) => (e.id === entryId ? { ...e, ...patch } : e)));

  /** 좋아요 — 먼저 표시를 바꾸고 서버가 실패하면 되돌린다. 자기 것에는 하지 않는다. */
  const toggleLike = async (entry: EntryCard) => {
    if (!canReact(entry) || busy) return;
    const before = { liked: entry.liked, likeCount: entry.like_count };
    const next = optimisticLike(before);
    patchEntry(entry.id, { liked: next.liked, like_count: next.likeCount });
    setBusy(true);
    try {
      const result = await api.likeEntry(entry.id, next.liked);
      patchEntry(entry.id, { liked: result.liked, like_count: result.like_count });
    } catch (e) {
      patchEntry(entry.id, { liked: before.liked, like_count: before.likeCount });
      void alert({ title: t('react.menuLike'), message: reactFailureMessage(reactFailure(e)) });
    } finally {
      setBusy(false);
    }
  };

  /** 저장 — 다시 찾아볼 개인 북마크다. 자기 것은 저장하지 않는다. */
  const toggleSave = async (entry: EntryCard) => {
    if (!canReact(entry) || busy) return;
    const next = optimisticSave(entry.saved);
    patchEntry(entry.id, { saved: next });
    setBusy(true);
    try {
      const result = await api.saveEntry(entry.id, next);
      patchEntry(entry.id, { saved: result.saved });
    } catch (e) {
      patchEntry(entry.id, { saved: entry.saved });
      void alert({ title: t('react.menuSave'), message: reactFailureMessage(reactFailure(e)) });
    } finally {
      setBusy(false);
    }
  };

  /** 차단 — 그 사람의 참여작이 이 화면에서 바로 사라진다. 상대에게는 알리지 않는다. */
  const blockAuthor = async (entry: EntryCard) => {
    const authorId = entry.author.user_id ?? null;
    if (!canBlock({ authorId, myId: user?.id ?? null })) return;
    const ok = await confirm({
      title: t('react.blockTitle'),
      message: t('react.blockBody'),
      confirmLabel: t('react.blockConfirm'),
      destructive: true,
    });
    if (!ok) return;
    try {
      await api.blockUser(authorId as string, true);
      setEntries((prev) => removeAuthored(prev ?? [], authorId as string));
      setActive(0);
      void alert({ title: t('react.menuBlock'), message: t('react.blockDone') });
    } catch (e) {
      void alert({ title: t('react.menuBlock'), message: blockFailureMessage(e) });
    }
  };

  const sendReport = async (reason: ReportReason, note: string) => {
    const target = reportTarget;
    setReportTarget(null);
    if (!target) return;
    try {
      await api.createReport(
        buildReportBody({ requestId: newRequestId(), target: target.type, targetId: target.id, reason, note }),
      );
      logEvent('challenge_report', { reason, target: target.type });
      void alert({ title: t('videoReport.doneTitle'), message: reportDoneMessage(target.type) });
      if (target.type === 'entry') {
        setEntries((prev) => (prev ?? []).filter((e) => e.id !== target.id));
      }
    } catch (e) {
      void alert({ title: t('videoReport.title'), message: reportFailureMessage(reportFailure(e)) });
    }
  };

  /** 반응 메뉴 — 신고·차단·공유를 한자리에 둔다. */
  const openMenu = (entry: EntryCard) => {
    void sheet({
      title: entry.author.name,
      actions: [
        ...(canReact(entry)
          ? [
              { label: t('react.menuLike'), onPress: () => void toggleLike(entry) },
              { label: t('react.menuSave'), onPress: () => void toggleSave(entry) },
            ]
          : []),
        { label: t('react.menuShare'), onPress: () => share(entry) },
        // 내 참여작은 스스로 신고할 수 없다 — 남의 참여작에만 「신고」를 둔다(pen C6.7 리뷰, 10/24).
        ...(canReact(entry)
          ? [{ label: t('react.menuReport'), destructive: true, onPress: () => setReportTarget({ type: 'entry', id: entry.id }) }]
          : []),
        ...(challenge
          ? [
              {
                label: t('react.menuReportChallenge'),
                destructive: true,
                onPress: () => setReportTarget({ type: 'challenge', id: challenge.id }),
              },
            ]
          : []),
        ...(canBlock({ authorId: entry.author.user_id ?? null, myId: user?.id ?? null })
          ? [{ label: t('react.menuBlock'), destructive: true, onPress: () => void blockAuthor(entry) }]
          : []),
      ],
    });
  };

  const renderItem = ({ item, index }: { item: EntryCard; index: number }) => {
    const isActive = index === active;
    const canTouch = canReact(item);
    return (
      <View style={{ width, height }}>
        {isActive && item.playback_url && (
          <VideoView style={StyleSheet.absoluteFill} player={player} contentFit="cover" nativeControls={false} />
        )}
        <Pressable style={StyleSheet.absoluteFill} onPress={togglePlay} accessibilityRole="button" ph-label="challenge_play_toggle">
          {isActive && !playing && (
            <View style={styles.pauseCenter}>
              <Feather name="play" size={40} color="rgba(255,255,255,0.9)" />
            </View>
          )}
        </Pressable>
        {isActive && playFailed && (
          <View style={styles.playFail} pointerEvents="box-none">
            <View style={styles.playFailCard}>
              <Feather name="video-off" size={26} color="#FFFFFF" />
              <Text style={styles.playFailTitle}>{t('challenges.playFailTitle')}</Text>
              <Text style={styles.playFailText}>{t('challenges.playFailSub')}</Text>
              <View style={styles.playFailRow}>
                <Pressable style={styles.playFailClose} onPress={() => router.back()} accessibilityRole="button" ph-label="challenge_play_fail_close">
                  <Text style={styles.playFailCloseText}>{t('challenges.playFailClose')}</Text>
                </Pressable>
                <Pressable
                  style={styles.playFailRetry}
                  onPress={() => {
                    setPlayFailed(false);
                    setRetryTick((n) => n + 1);
                  }}
                  accessibilityRole="button"
                  ph-label="challenge_play_fail_retry">
                  <Text style={styles.playFailRetryText}>{t('challenges.playFailRetry')}</Text>
                </Pressable>
              </View>
            </View>
          </View>
        )}
        <View style={styles.scrimTop} pointerEvents="none" />
        <View style={styles.scrimBottom} pointerEvents="none" />

        <SafeAreaView style={styles.overlay} edges={['top', 'bottom']} pointerEvents="box-none">
          <View style={styles.top}>
            <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button" ph-label="challenge_play_close">
              <Feather name="x" size={26} color="#FFFFFF" />
            </Pressable>
            <View style={styles.author}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{avatarLetter(item.author.name)}</Text>
              </View>
              <Text style={styles.authorName}>{item.author.name}</Text>
            </View>
            <View style={styles.topRight}>
              <Pressable
                onPress={() => setMuted((v) => !v)}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={t(muted ? 'react.unmute' : 'react.mute')}
                ph-label="challenge_play_mute">
                <Feather name={muted ? 'volume-x' : 'volume-2'} size={22} color="#FFFFFF" />
              </Pressable>
              <Pressable onPress={() => openMenu(item)} hitSlop={10} accessibilityRole="button" ph-label="challenge_play_more">
                <Feather name="more-horizontal" size={24} color="#FFFFFF" />
              </Pressable>
            </View>
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
                style={[styles.action, !canTouch && styles.actionOff]}
                onPress={() => void toggleLike(item)}
                disabled={!canTouch}
                accessibilityRole="button"
                accessibilityLabel={t('react.menuLike')}
                ph-label="challenge_play_like">
                <Feather name="heart" size={22} color={item.liked ? palette.danger : '#FFFFFF'} />
                <Text style={styles.actionText}>{item.like_count}</Text>
              </Pressable>
              <Pressable
                style={[styles.action, !canTouch && styles.actionOff]}
                onPress={() => void toggleSave(item)}
                disabled={!canTouch}
                accessibilityRole="button"
                accessibilityLabel={t('react.menuSave')}
                ph-label="challenge_play_save">
                <Feather name="bookmark" size={22} color={item.saved ? '#FFD84D' : '#FFFFFF'} />
              </Pressable>
              <Pressable style={styles.action} onPress={() => setCommentsOpen(true)} accessibilityRole="button" accessibilityLabel={t('react.menuComment')} ph-label="challenge_play_comment">
                <Feather name="message-circle" size={22} color="#FFFFFF" />
                <Text style={styles.actionText}>{item.comment_count}</Text>
              </Pressable>
              <Pressable style={styles.action} onPress={() => share(item)} accessibilityRole="button" accessibilityLabel={t('react.menuShare')} ph-label="challenge_play_share">
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
      {/* 불러오는 중이거나 실패했을 때도 항상 닫을 수 있게 한다(SOMA-738). */}
      {(entries === null || !!error) && (
        <SafeAreaView style={styles.loadingClose} edges={['top']} pointerEvents="box-none">
          <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('common.close')} ph-label="challenge_play_close">
            <Feather name="x" size={26} color="#FFFFFF" />
          </Pressable>
        </SafeAreaView>
      )}
      {entries !== null && entries.length === 0 && !error && (
        <SafeAreaView style={styles.emptyWrap} edges={['top', 'bottom']}>
          <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button" ph-label="challenge_play_close" style={styles.emptyClose}>
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
          extraData={{ active, playing }}
        />
      )}
      {atEnd && (
        <View style={styles.endNotice} pointerEvents="none">
          <Text style={styles.endText}>{t('challenges.feedEnd')}</Text>
        </View>
      )}
      <ChallengeCommentsSheet
        visible={commentsOpen}
        entryId={entries?.[active]?.id ?? null}
        onClose={() => setCommentsOpen(false)}
        onCountChange={(delta) => {
          const current = entries?.[active];
          if (current) patchEntry(current.id, { comment_count: commentCountAfter(current.comment_count, delta) });
        }}
        onReport={(commentId) => {
          setCommentsOpen(false);
          setReportTarget({ type: 'comment', id: commentId });
        }}
      />
      <ChallengeReportSheet
        visible={reportTarget !== null}
        target={reportTarget?.type ?? 'entry'}
        onClose={() => setReportTarget(null)}
        onSubmit={(reason, note) => void sendReport(reason, note)}
      />
      {dialog}
      {entryShare.sheet}
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
  loadingClose: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 16, paddingTop: 8 },
  playFail: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  playFailCard: { alignItems: 'center', gap: 8, borderRadius: 20, backgroundColor: 'rgba(30,30,30,0.85)', paddingVertical: 22, paddingHorizontal: 24, alignSelf: 'stretch' },
  playFailTitle: { color: '#FFFFFF', fontSize: 16, fontWeight: '800', textAlign: 'center', marginTop: 4 },
  playFailText: { color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: '500', textAlign: 'center' },
  playFailRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  playFailClose: { height: 44, minWidth: 80, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  playFailCloseText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  playFailRetry: { height: 44, minWidth: 100, borderRadius: 12, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  playFailRetryText: { color: '#191F28', fontSize: 14, fontWeight: '800' },
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
  storyLabel: { fontSize: 12, fontWeight: '800', color: 'rgba(255,255,255,0.8)' },
  line: { fontSize: 22, fontWeight: '800', color: '#FFFFFF', lineHeight: 30 },
  work: { fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.75)' },
  actions: { flexDirection: 'row', gap: 22, marginTop: 6 },
  topRight: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  actionOff: { opacity: 0.4 },
  actionText: { fontSize: 14, fontWeight: '800', color: '#FFFFFF' },
  performBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 14,
    height: 48,
    marginTop: 6,
  },
  pressed: { opacity: 0.85 },
  performText: { fontSize: 15, fontWeight: '800', color: '#FFFFFF' },
});
