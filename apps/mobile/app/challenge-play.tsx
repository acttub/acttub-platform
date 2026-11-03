import Feather from '@expo/vector-icons/Feather';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { StatusBar } from 'expo-status-bar';
import { useIsFocused } from '@react-navigation/native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type GestureResponderEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppDialog, type DialogAction } from '@/components/app-dialog';
import { ChallengeCommentsSheet } from '@/components/challenge-comments-sheet';
import { ChallengeReportSheet } from '@/components/challenge-report-sheet';
import { useEntryShare } from '@/components/entry-share-sheet';
import { pt } from '@/components/ui/anchored-menu';
import { UserAvatar } from '@/components/ui/default-avatar';
import { DialogButtons, DialogCard } from '@/components/ui/dialog';
import { MASCOT } from '@/components/ui/mascot';
import { StatusScreen } from '@/components/ui/status-screen';
import { Toast } from '@/components/ui/toast';
import { ScrimGradient } from '@/components/ui/band-gradient';
import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';
import { logEvent } from '@/lib/analytics';
import { api } from '@/lib/api';
import { browseFailure, browseFailureMessage, canPerform, isEnded, rankEntries } from '@/lib/challenge/browse';
import { blockFailureMessage, buildReportBody, canBlock, removeAuthored, reportDoneMessage, reportFailure, reportFailureMessage } from '@/lib/challenge/moderation';
import { commentCountAfter } from '@/lib/challenge/entry';
import { playMenuItems, type PlayMenuItem } from '@/lib/challenge/menu';
import {
  canReact,
  DOUBLE_TAP_MS,
  doubleTapAction,
  isDoubleTap,
  optimisticLike,
  optimisticSave,
  reactFailure,
  reactFailureMessage,
  type LastTap,
} from '@/lib/challenge/react';
import type { ChallengeDetail, EntryCard, ReportReason, ReportTarget } from '@/lib/challenge/types';
import { createViewTracker, VIEW_THRESHOLD_MS } from '@/lib/challenge/views';
import { enteredChallengeIds } from '@/lib/challenge/entered';
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
 *
 * 영상을 두 번 누르면 인스타처럼 누른 자리에 하트가 뜨고 좋아요가 된다(이미 눌렀으면 취소하지
 * 않고 하트만). 한 번 누르기(재생·멈춤)는 두 번 누르기와 구분하려고 DOUBLE_TAP_MS 만큼 늦게 반응한다.
 */
export default function ChallengePlayScreen() {
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  // SafeAreaView 대신 루트 값을 쓴다 — 전체 화면 모달 안의 SafeAreaView 는 올라오는 중 받은 0을 고치지 않아 iOS 에서 닫기가 상태 표시줄 밑에 깔렸다.
  const insets = useSafeAreaInsets();
  const { alert, confirm, sheet, dialog } = useAppDialog();
  const { user } = useAuth();
  const { id, entryId } = useLocalSearchParams<{ id?: string; entryId?: string }>();
  const [challenge, setChallenge] = useState<ChallengeDetail | null>(null);
  // 이미 참여했으면(나만 보기 포함) 빈 화면에서 「첫 번째로 참여해 보세요」를 띄우지 않고 버튼도 「한 번 더 찍기」로 둔다(SOMA-995).
  const [entered, setEntered] = useState(false);
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
  /** 목록을 못 받았을 때 「다시 시도」로 처음부터 다시 받는다. */
  const [reload, setReload] = useState(0);
  // 모자이크를 잠시 빼고 원본으로 보는 내 참여작(SOMA-809). 다른 참여작으로 넘기면 그 참여작은 모자이크본이다.
  const [originalFor, setOriginalFor] = useState<string | null>(null);
  const resumeAt = useRef(0);
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
    const cid = challenge?.id;
    if (!cid) return;
    let live = true;
    void enteredChallengeIds().then((ids) => {
      if (live) setEntered(ids.has(cid));
    });
    return () => {
      live = false;
    };
  }, [challenge?.id]);

  useEffect(() => {
    if (!id && !entryId) return;
    let alive = true;
    // 저장한 영상·내 영상에서는 챌린지 id 없이 참여작 id 만 넘어온다 — 참여작에서 챌린지를 알아낸다.
    // 내 비공개 참여작은 피드(공개 목록)에 없어 404 가 되므로 그 참여작 한 개만 보여 준다(SOMA-738).
    void (async () => {
      // 챌린지 id 를 알면 참여작·챌린지·목록을 한꺼번에 묻는다 — 전에는 셋을 차례로 받아 영상이 늦게 떴다(11/2 폰 QA).
      const ownRead = entryId ? api.getEntry(entryId).catch(() => null) : Promise.resolve(null);
      const challengeId = id ?? (await ownRead)?.challenge_id;
      if (!challengeId) throw Object.assign(new Error('not_found'), { status: 404 });
      const listRead = api.listChallengeEntries(challengeId, { sort: 'likes', fromEntry: entryId });
      listRead.catch(() => undefined);
      const [detail, own] = await Promise.all([api.getChallenge(challengeId), ownRead]);
      try {
        const list = await listRead;
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
  }, [entryId, id, reload]);

  // 보던 맨 끝 참여작을 신고로 빼면 보던 자리가 비므로 효과가 돌기 전에 남은 마지막 참여작으로 당긴다.
  if (entries?.length && active >= entries.length) setActive(entries.length - 1);

  // 페이지가 바뀌면 그 참여작의 영상으로 갈아끼운다. 원본·모자이크본을 바꿀 때도 보던 자리에서 이어 튼다.
  useEffect(() => {
    const entry = entries?.[active];
    const source = entry ? sourceOf(entry, originalFor) : null;
    setPlayFailed(!source && entries !== null && entries.length > 0);
    if (!source) return;
    // replaceAsync — replace 는 iOS 에서 영상을 주 스레드로 불러와 넘길 때 화면이 멈출 수 있다(SOMA-713).
    let alive = true;
    void player
      .replaceAsync(source)
      .then(() => {
        if (!alive) return;
        if (resumeAt.current > 0) {
          player.currentTime = resumeAt.current;
          resumeAt.current = 0;
        }
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
  }, [active, entries, player, retryTick, originalFor]);

  /** 내 참여작의 원본·모자이크본을 바꾼다. 보던 자리는 그대로 둔다. */
  const toggleOriginal = (entry: EntryCard) => {
    resumeAt.current = player.currentTime;
    setOriginalFor((was) => (was === entry.id ? null : entry.id));
  };

  // 위에 촬영 같은 다른 화면이 올라오면 영상을 내려놓아 메모리를 돌려주고, 돌아오면 보던 참여작을 다시 튼다(SOMA-699).
  useEffect(() => {
    if (focused) return;
    player.pause();
    void player.replaceAsync(null).catch(() => {});
    return () => {
      const entry = entries?.[active];
      const source = entry ? sourceOf(entry, originalFor) : null;
      if (!source) return;
      // 가려진 채로 화면이 닫히면 플레이어가 먼저 풀려 있을 수 있다 — 그때는 다시 틀 필요가 없다.
      try {
        void player
          .replaceAsync(source)
          .then(() => {
            player.play();
            setPlaying(true);
          })
          .catch(() => {});
      } catch {}
    };
    // 가려진 동안 entries·active·originalFor 는 바뀌지 않는다 — 돌아올 때 그때의 참여작을 다시 튼다.
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
  // 한 번 누르기는 잠깐 기다렸다가 처리하므로 그때의 최신 재생 상태로 바꾸게 한다.
  const togglePlayRef = useRef(togglePlay);
  togglePlayRef.current = togglePlay;

  const lastTap = useRef<LastTap | null>(null);
  const singleTapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 두 번 누른 자리에 띄울 하트. key 가 바뀌면 애니메이션을 처음부터 다시 한다. */
  const [burst, setBurst] = useState<{ key: number; x: number; y: number; tilt: number } | null>(null);
  const cancelSingleTap = () => {
    if (singleTapTimer.current) clearTimeout(singleTapTimer.current);
    singleTapTimer.current = null;
  };
  // 다른 참여작으로 넘기거나 화면을 닫으면 기다리던 한 번 누르기와 하트를 버린다.
  useEffect(() => {
    cancelSingleTap();
    lastTap.current = null;
    setBurst(null);
  }, [active]);
  useEffect(() => cancelSingleTap, []);

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
      void alert({ title: t('react.likeFailTitle'), message: reactFailureMessage(reactFailure(e)) });
    } finally {
      setBusy(false);
    }
  };

  /** 영상 누르기 — 한 번은 재생·멈춤, 같은 참여작을 빠르게 두 번 누르면 좋아요(인스타식). */
  const onVideoPress = (entry: EntryCard, e: GestureResponderEvent) => {
    const now = Date.now();
    if (!isDoubleTap(lastTap.current, now, entry.id)) {
      lastTap.current = { at: now, entryId: entry.id };
      cancelSingleTap();
      singleTapTimer.current = setTimeout(() => {
        singleTapTimer.current = null;
        togglePlayRef.current();
      }, DOUBLE_TAP_MS);
      return;
    }
    // 계속 빠르게 누르면 하트만 더 띄우고 재생·멈춤은 건드리지 않는다.
    lastTap.current = { at: now, entryId: entry.id };
    cancelSingleTap();
    const action = doubleTapAction(entry);
    if (action === 'none') return;
    const x = e?.nativeEvent?.locationX ?? width / 2;
    const y = e?.nativeEvent?.locationY ?? height / 2;
    setBurst({ key: now, x, y, tilt: Math.round(Math.random() * 30 - 15) });
    try {
      void Promise.resolve(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)).catch(() => {});
    } catch {
      // 진동이 안 되는 기기에서도 좋아요는 그대로 한다.
    }
    if (action === 'like') {
      logEvent('challenge_double_tap_like', { id: entry.id });
      void toggleLike(entry);
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
      void alert({ title: t('react.saveFailTitle'), message: reactFailureMessage(reactFailure(e)) });
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
      void alert({ title: t('react.blockDoneTitle'), message: t('react.blockDone') });
    } catch (e) {
      void alert({ title: t('react.blockFailTitle'), message: blockFailureMessage(e) });
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
      void alert({ title: t('videoReport.failTitle'), message: reportFailureMessage(reportFailure(e)) });
    }
  };

  /** ⋯ 메뉴 — 화면에 버튼이 있는 좋아요·저장·공유는 빼고 신고·차단만(lib/challenge/menu). */
  const menuFor = (entry: EntryCard) => playMenuItems({ entry, challenge, myId: user?.id ?? null });
  const openMenu = (entry: EntryCard, e?: GestureResponderEvent) => {
    const action: Record<PlayMenuItem, DialogAction> = {
      report_entry: { label: t('react.menuReport'), icon: 'flag', onPress: () => setReportTarget({ type: 'entry', id: entry.id }) },
      report_challenge: {
        label: t('react.menuReportChallenge'),
        icon: 'flag',
        onPress: () => challenge && setReportTarget({ type: 'challenge', id: challenge.id }),
      },
      block: { label: t('react.menuBlock'), icon: 'slash', onPress: () => void blockAuthor(entry) },
    };
    void sheet({ anchor: pt(e), actions: menuFor(entry).map((item) => action[item]) });
  };

  const renderItem = ({ item, index }: { item: EntryCard; index: number }) => {
    const isActive = index === active;
    const canTouch = canReact(item);
    return (
      <View style={{ width, height }}>
        {isActive && sourceOf(item, originalFor) && (
          <VideoView style={StyleSheet.absoluteFill} player={player} contentFit="cover" nativeControls={false} />
        )}
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={(e) => onVideoPress(item, e)}
          accessibilityRole="button"
          ph-label="challenge_play_toggle">
          {isActive && !playing && (
            <View style={styles.pauseCenter}>
              <Feather name="play" size={40} color={palette.onAccent} />
            </View>
          )}
        </Pressable>
        {isActive && burst && (
          <LikeBurst key={burst.key} x={burst.x} y={burst.y} tilt={burst.tilt} onDone={() => setBurst(null)} />
        )}
        {/* 위·아래 막은 가장자리만 진하고 영상 쪽으로 갈수록 투명해진다 — 아래 절반을 같은 진하기로 덮던 박스를 바꿨다. */}
        <ScrimGradient color={SCRIM_COLOR} alphas={SCRIM_TOP} height={130} style={styles.scrimTop} />
        <ScrimGradient color={SCRIM_COLOR} alphas={SCRIM_BOTTOM} height={330} style={styles.scrimBottom} />

        <View style={[styles.overlay, { paddingTop: insets.top, paddingBottom: insets.bottom }]} pointerEvents="box-none">
          <View style={styles.top}>
            <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button" ph-label="challenge_play_close">
              <Feather name="x" size={24} color={palette.onAccent} />
            </Pressable>
            <View style={styles.author}>
              <UserAvatar size={24} radius={12} seed={item.author.user_id} photoUrl={item.author.photo_url} />
              <Text style={styles.authorName}>{item.author.name}</Text>
            </View>
            <View style={styles.topRight}>
              <Pressable
                onPress={() => setMuted((v) => !v)}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={t(muted ? 'react.unmute' : 'react.mute')}
                ph-label="challenge_play_mute">
                <Feather name={muted ? 'volume-x' : 'volume-2'} size={22} color={palette.onAccent} />
              </Pressable>
              {menuFor(item).length > 0 ? (
                <Pressable
                  onPress={(e) => openMenu(item, e)}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel={t('react.moreA11y')}
                  ph-label="challenge_play_more">
                  <Feather name="more-horizontal" size={24} color={palette.onAccent} />
                </Pressable>
              ) : null}
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
            {item.is_mine && !!item.original_playback_url && (
              <Pressable
                style={styles.originalToggle}
                onPress={() => toggleOriginal(item)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={t(originalFor === item.id ? 'challenges.showMosaic' : 'challenges.showOriginal')}
                ph-label="challenge_play_original_toggle">
                <Feather name={originalFor === item.id ? 'eye-off' : 'eye'} size={14} color={palette.onAccent} />
                <Text style={styles.originalToggleText}>{t(originalFor === item.id ? 'challenges.showMosaic' : 'challenges.showOriginal')}</Text>
              </Pressable>
            )}

            <View style={styles.actions}>
              <Pressable
                style={[styles.action, !canTouch && styles.actionOff]}
                onPress={() => void toggleLike(item)}
                disabled={!canTouch}
                accessibilityRole="button"
                accessibilityLabel={t('react.menuLike')}
                ph-label="challenge_play_like">
                {item.liked ? (
                  <MaterialCommunityIcons name="heart" size={22} color={palette.danger} testID="liked-heart" />
                ) : (
                  <Feather name="heart" size={22} color={palette.onAccent} />
                )}
                <Text style={styles.actionText}>{item.like_count}</Text>
              </Pressable>
              <Pressable
                style={[styles.action, !canTouch && styles.actionOff]}
                onPress={() => void toggleSave(item)}
                disabled={!canTouch}
                accessibilityRole="button"
                accessibilityLabel={t('react.menuSave')}
                ph-label="challenge_play_save">
                {item.saved ? (
                  <MaterialCommunityIcons name="bookmark-check" size={24} color={palette.onAccent} testID="saved-bookmark" />
                ) : (
                  <Feather name="bookmark" size={22} color={palette.onAccent} />
                )}
              </Pressable>
              <Pressable style={styles.action} onPress={() => setCommentsOpen(true)} accessibilityRole="button" accessibilityLabel={t('react.menuComment')} ph-label="challenge_play_comment">
                <Feather name="message-circle" size={22} color={palette.onAccent} />
                <Text style={styles.actionText}>{item.comment_count}</Text>
              </Pressable>
              <Pressable style={styles.action} onPress={() => share(item)} accessibilityRole="button" accessibilityLabel={t('react.menuShare')} ph-label="challenge_play_share">
                <Feather name="share-2" size={22} color={palette.onAccent} />
              </Pressable>
            </View>

            {challenge && !isEnded(challenge) && (
              <Pressable
                style={({ pressed }) => [styles.performBtn, pressed && styles.pressed]}
                onPress={perform}
                accessibilityRole="button">
                <Feather name="video" size={16} color={palette.onAccent} />
                <Text style={styles.performText}>{t(entered ? 'challenges.performAgainCta' : 'challenges.performCta')}</Text>
              </Pressable>
            )}
          </View>
        </View>
        {isActive && playFailed && (
          <View style={styles.playFail}>
            <DialogCard title={t('challenges.playFailTitle')} message={t('challenges.playFailSub')}>
              <DialogButtons
                cancelLabel={t('challenges.playFailClose')}
                onCancel={() => router.back()}
                confirmLabel={t('challenges.playFailRetry')}
                onConfirm={() => {
                  setPlayFailed(false);
                  setRetryTick((n) => n + 1);
                }}
              />
            </DialogCard>
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar style={error || entries?.length === 0 ? 'dark' : 'light'} />
      {/* 불러오는 중에도 항상 닫을 수 있게 한다(SOMA-738). */}
      {entries === null && (
        <View style={[styles.loadingClose, { paddingTop: 8 + insets.top }]} pointerEvents="box-none">
          <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('common.close')} ph-label="challenge_play_close">
            <Feather name="x" size={24} color={palette.onAccent} />
          </Pressable>
        </View>
      )}
      {!!error && (
        <StatusScreen
          safeArea
          header={t('challenges.entryTitle')}
          onBack={() => router.back()}
          title={t('challenges.loadFailTitle')}
          body={error}
          primary={{
            label: t('common.retry'),
            onPress: () => {
              setError(null);
              setEntries(null);
              setReload((n) => n + 1);
            },
          }}
        />
      )}
      {entries !== null && entries.length === 0 && !error && (
        <StatusScreen
          safeArea
          kind="empty"
          mascot={MASCOT.shy}
          header={t('challenges.entryTitle')}
          onBack={() => router.back()}
          title={t(entered ? 'challenges.emptyOthersTitle' : 'challenges.emptyEntriesTitle')}
          body={t(entered ? 'challenges.emptyOthersSub' : 'challenges.emptyEntriesSub')}
          primary={challenge && !isEnded(challenge) ? { label: t(entered ? 'challenges.performAgainCta' : 'challenges.performCta'), onPress: perform } : undefined}
        />
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
        <Toast
          icon="info"
          message={t('challenges.feedEnd')}
          bottom={insets.bottom + space[4] + ACTION_ROW + space[3] + (challenge && !isEnded(challenge) ? 48 + space[3] : 0)}
        />
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

const BURST_SIZE = 96;

/** 두 번 누른 자리에 떠오르는 하트 — 튀어 커졌다가 잠깐 머문 뒤 살짝 커지며 사라진다. 누르기를 막지 않는다. */
function LikeBurst({ x, y, tilt, onDone }: { x: number; y: number; tilt: number; onDone: () => void }) {
  const scale = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const anim = Animated.sequence([
      Animated.spring(scale, { toValue: 1, friction: 4, tension: 140, useNativeDriver: true }),
      Animated.delay(250),
      Animated.parallel([
        Animated.timing(opacity, { toValue: 0, duration: 220, useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1.25, duration: 220, useNativeDriver: true }),
      ]),
    ]);
    anim.start(({ finished }) => finished && onDone());
    return () => anim.stop();
    // 한 번 뜬 하트는 끝까지 같은 애니메이션을 한다(새로 누르면 key 가 바뀌어 새 하트가 된다).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <Animated.View
      pointerEvents="none"
      testID="like-burst"
      style={[
        styles.burst,
        { left: x - BURST_SIZE / 2, top: y - BURST_SIZE / 2, opacity, transform: [{ rotate: `${tilt}deg` }, { scale }] },
      ]}>
      <MaterialCommunityIcons name="heart" size={BURST_SIZE} color={palette.danger} />
    </Animated.View>
  );
}

/** 재생할 주소. 원본 보기를 켠 내 참여작이고 원본 주소가 있을 때만 원본이다. */
function sourceOf(entry: EntryCard, originalFor: string | null): string | null {
  return originalFor === entry.id && entry.original_playback_url ? entry.original_playback_url : entry.playback_url;
}

/** 아래 행동 줄(좋아요·저장·댓글·공유) 높이 — 토스트를 그 위에 띄운다. */
const ACTION_ROW = 32;

// 막 색은 palette.scrim(#0F141E)과 같다. 진하기: 아래 끝 55%, 위 끝 35%, 영상 쪽 끝은 0%.
const SCRIM_COLOR = '#0F141E';
const SCRIM_TOP = [[0, 0.35], [1, 0]] as const;
const SCRIM_BOTTOM = [[0, 0], [0.35, 0.15], [1, 0.55]] as const;
// 막이 옅어진 만큼 밝은 영상 위 흰 글자가 묻히지 않게 옅은 그림자를 준다.
const MEDIA_TEXT_SHADOW = { textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 };

const styles = StyleSheet.create({
  playFail: { ...StyleSheet.absoluteFillObject, backgroundColor: palette.scrim, alignItems: 'center', justifyContent: 'center', padding: space.gutter },
  loadingClose: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: space[4] },
  root: { flex: 1, backgroundColor: palette.text },
  flex: { flex: 1 },
  pauseCenter: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  burst: { position: 'absolute', width: BURST_SIZE, height: BURST_SIZE, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } },
  scrimTop: { top: 0 },
  scrimBottom: { bottom: 0 },
  overlay: { flex: 1, justifyContent: 'space-between' },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space[4], paddingTop: space[2] },
  author: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  authorName: { ...type.body2Bold, color: palette.onAccent, ...MEDIA_TEXT_SHADOW },
  bottom: { paddingHorizontal: space.gutter, paddingBottom: space[4], gap: space[2] },
  storyLabel: { ...type.micro, color: palette.onMediaSub, ...MEDIA_TEXT_SHADOW },
  originalToggle: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1.5],
    marginTop: space[2],
    paddingHorizontal: space[3],
    paddingVertical: space[1.5],
    borderRadius: radius.full,
    backgroundColor: palette.scrim,
  },
  originalToggleText: { ...type.captionBold, color: palette.onAccent },
  line: { ...type.title2, color: palette.onAccent, ...MEDIA_TEXT_SHADOW },
  work: { ...type.caption, color: palette.onMediaSub, ...MEDIA_TEXT_SHADOW },
  actions: { flexDirection: 'row', alignItems: 'center', gap: space[5], height: ACTION_ROW, marginTop: space[1] },
  topRight: { flexDirection: 'row', alignItems: 'center', gap: space[4] },
  action: { flexDirection: 'row', alignItems: 'center', gap: space[1.5] },
  actionOff: { opacity: 0.4 },
  actionText: { ...type.body2Bold, color: palette.onAccent, ...MEDIA_TEXT_SHADOW },
  performBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[2],
    backgroundColor: palette.blue,
    borderRadius: radius.lg,
    height: 48,
    marginTop: space[1],
  },
  pressed: { opacity: 0.85 },
  performText: { ...type.headline, color: palette.onAccent },
});
