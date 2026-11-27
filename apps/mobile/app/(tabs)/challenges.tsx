import Feather from '@expo/vector-icons/Feather';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { BackHandler, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AdSlot } from '@/components/ad-slot';
import { ChallengeOthersRow } from '@/components/challenge-others-row';
import { MASCOT } from '@/components/ui/mascot';
import { LoadingText } from '@/components/ui/loading-text';
import { PrimaryButton } from '@/components/ui/buttons';
import { CtaBar } from '@/components/ui/cta-bar';
import { FLOATING_ADD_HEIGHT, FloatingAdd, useTabFloatingAddBottom } from '@/components/ui/floating-add';
import { UserAvatar } from '@/components/ui/default-avatar';
import { InlineEmpty } from '@/components/ui/inline-empty';
import { InlineError } from '@/components/ui/inline-error';
import { SelectCard } from '@/components/ui/select-card';
import { SkeletonRows } from '@/components/ui/skeleton';
import { NavIconButton } from '@/components/ui/nav-header';
import { useTabBarSpace } from '@/components/ui/tab-bar';
import { heroCard } from '@/constants/hero-card';
import { easing, motion } from '@/constants/motion';
import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';
import { useFirstTimeUser } from '@/hooks/use-first-time-user';
import { logEvent } from '@/lib/analytics';
import { api } from '@/lib/api';
import {
  browseFailure,
  browseFailureMessage,
  canPerform,
  canRetryBrowse,
  dDayLabel,
  participantsLabel,
  type BrowseFailure,
} from '@/lib/challenge/browse';
import {
  hasBrowsedChallenges,
  hasFinishedFirstChallenge,
  markChallengesBrowsed,
  markFirstChallengeFinished,
} from '@/lib/challenge/intro-state';
import { countedPractices } from '@/lib/practice/counted';
import { skipsChallengeFirstPick } from '@/lib/returning-account';
import { useExampleUrl } from '@/lib/challenge/use-example-url';
import { lastWeekResult } from '@/lib/challenge/week-result';
import { useUnreadNotifications } from '@/hooks/use-unread-notifications';
import type { ChallengeCard, ChallengeListResponse, ChallengeTab, MyEntriesResponse } from '@/lib/challenge/types';
import { lastRead } from '@/lib/last-reads';
import type { PracticeGroupDetail } from '@/lib/practice/types';
import { enteredChallengeIds } from '@/lib/challenge/entered';
import { translate as t } from '@/lib/i18n';

/**
 * A16 대사 목록(challenge.browse) — 챌린지는 대사 한 줄과 기간이다.
 *
 * 탭은 인기(좋아요 합, 같으면 참여작 수)·최신(공개 개설 시각)·종료(ends_at 역순)·내 챌린지(내가
 * 참여작을 가진 챌린지)다. 오늘의 챌린지는 인기·최신 맨 위에만 고정한다. 카드에는 대사, 작품·인물·
 * 메모, 참여작 수, 좋아요 합, 참여자 셋의 이름 첫 글자와 +N, "나도 이 대사 연기하기"가 있다.
 * 시작 안내(A14)는 기기당 한 번이다. 게스트·한국어가 아닌 회원은 403 member_only 라 안내만 한다.
 *
 * SOMA-748 새 디자인(ZxMmEh): 맨 위 「지난주 결과」 띠(끝난 지 7일 안의 공식 챌린지) → 이번 주 대사 카드 → 탭 →
 * 줄 카드. 파란 「누를 것 안내」는 첫 참여를 끝낼 때까지만 보인다.
 *
 * SOMA-1121: 게시판은 커뮤니티 탭(app/(tabs)/community)으로 나가 이 탭은 다시 「챌린지」 하나다. 라우트 이름(challenges)은
 * 그대로 두어 챌린지 탭으로 오는 딥링크·푸시가 계속 열린다. 예전 `?section=board` 주소로 오면 커뮤니티 탭으로 넘긴다.
 *
 * SOMA-1122: 칩(인기·최신·종료·내 챌린지)을 없애고 세 구역으로 둔다 — ① 이번 주 공식 대사(바로 연기하기) ② 공식 챌린지
 * (진행 중 + 지난주 결과 + 「지난 챌린지」) ③ 배우들이 연 챌린지(연 사람·참여 수·남은 날). 공식/배우는 ChallengeCard.origin
 * (team/member)으로 나눈다. 목록은 인기 탭 하나를 받고, 「지난 챌린지」는 같은 화면에서 종료 탭을 받아 보인다.
 * 내 참여작은 프로필 「참여작」에서 본다.
 */

/** 구역이 처음 보일 때 살짝 떠오른다 — 구역마다 조금씩 늦게. 「동작 줄이기」면 움직이지 않는다. */
const RISE_STAGGER_MS = 60;
function Rise({ index, testID, children }: { index: number; testID: string; children: ReactNode }) {
  const reduceMotion = useReducedMotion();
  return (
    <Animated.View
      testID={testID}
      style={styles.section}
      entering={reduceMotion ? undefined : FadeInDown.delay(index * RISE_STAGGER_MS).duration(motion.standard).easing(easing.enter)}>
      {children}
    </Animated.View>
  );
}

/**
 * 목록 맨 위에 고정할 오늘의 챌린지와 나머지 목록. 진행 중인 공식(팀) 챌린지가 늘 맨 위다 — 같은 무리 안의 순서는 서버 순서를 지킨다.
 * 오늘의 챌린지는 칩과 상관없이 늘 맨 위에 둔다(11/2 QA — 칩을 바꾸면 위 카드가 사라졌다). 서버는 인기 탭에만 featured 를
 * 주므로, 다른 칩에서는 앞서 받은 것(previous)을 그대로 두고 처음부터 다른 칩이면 진행 중인 공식 챌린지를 올린다.
 * 서버가 고른 게 회원 챌린지인데 진행 중인 공식 챌린지가 있으면 공식을 올린다. 고정한 챌린지는 아래 목록에서 뺀다 — 두 번 보이지 않게.
 */
function pinFeatured(
  result: ChallengeListResponse,
  previous: ChallengeCard | null,
): { pinned: ChallengeCard | null; rest: ChallengeCard[] } {
  const openTeam = (c: ChallengeCard) => c.origin === 'team' && Date.parse(c.ends_at) > Date.now();
  const teamFirst = [...result.challenges].sort((a, b) => Number(openTeam(b)) - Number(openTeam(a)));
  const officialPick = result.featured && !openTeam(result.featured) ? (teamFirst.find(openTeam) ?? result.featured) : result.featured;
  const pinned = officialPick ?? previous ?? teamFirst.find(openTeam) ?? null;
  return { pinned, rest: pinned ? teamFirst.filter((c) => c.id !== pinned.id) : teamFirst };
}

export default function ChallengesScreen() {
  const tabBarSpace = useTabBarSpace();
  const floatingAddBottom = useTabFloatingAddBottom();
  const router = useRouter();
  const firstTime = useFirstTimeUser();
  // 예전 주소 `?section=board`(게시판)로 오면 커뮤니티 탭으로 넘긴다 — 게시판은 독립 탭이 됐다(SOMA-1121).
  const { section: sectionParam } = useLocalSearchParams<{ section?: string }>();
  useEffect(() => {
    if (sectionParam === 'board') router.navigate('/community');
  }, [sectionParam, router]);
  const [tab, setTab] = useState<ChallengeTab>('popular');
  // 앱을 켠 뒤 미리 받아 둔 인기 목록이 있으면 그것으로 바로 그린다. 들어올 때마다 새로 받아 칸만 바꾼다(lib/last-reads).
  const [sharedPopular] = useState(() => {
    const read = lastRead<ChallengeListResponse>('challengesPopular');
    return read ? { ...pinFeatured(read, null), cursor: read.next_cursor } : null;
  });
  const [featured, setFeatured] = useState<ChallengeCard | null>(() => sharedPopular?.pinned ?? null);
  /** 마지막으로 고정한 오늘의 챌린지 — 인기 말고 다른 칩을 받을 때 그대로 둔다. */
  const featuredRef = useRef<ChallengeCard | null>(sharedPopular?.pinned ?? null);
  // 내가 참여한 챌린지(나만 보기 포함) — 오늘의 챌린지 버튼을 「한 번 더 찍기」로 바꾼다(SOMA-995).
  const [enteredIds, setEnteredIds] = useState<ReadonlySet<string>>(() => new Set());
  useFocusEffect(
    useCallback(() => {
      let live = true;
      void enteredChallengeIds().then((ids) => {
        if (live) setEnteredIds(ids);
      });
      return () => {
        live = false;
      };
    }, []),
  );
  const [challenges, setChallenges] = useState<ChallengeCard[] | null>(() => sharedPopular?.rest ?? null);
  const [cursor, setCursor] = useState<string | null>(() => sharedPopular?.cursor ?? null);
  const [loadingMore, setLoadingMore] = useState(false);
  /** 지금 보이는 탭. 이어 받는 중에 탭을 바꾸면 늦게 온 옛 탭의 결과를 버린다. */
  const shownTab = useRef<ChallengeTab>('popular');
  const [error, setError] = useState<BrowseFailure | null>(null);
  /** 지난주 결과 띠 — 끝난 지 7일 안의 공식 챌린지. 못 읽으면 띠만 없다. */
  const [lastWeek, setLastWeek] = useState<ChallengeCard | null>(() => {
    const ended = lastRead<ChallengeListResponse>('challengesEnded');
    return ended ? lastWeekResult(ended.challenges) : null;
  });
  /** 파란 「누를 것 안내」는 첫 챌린지 참여를 끝낼 때까지만. */
  const [showGuide, setShowGuide] = useState(false);
  /** 첫 챌린지 화면에서 「챌린지 둘러보기」를 고른 적이 있으면 기본 챌린지 홈을 보인다(SOMA-827). */
  const [browsed, setBrowsed] = useState(false);
  /** 첫 고르기 화면을 띄울지 기기·서버 기록으로 다 따져 봤는가. 따지기 전에는 띄우지 않는다. */
  const [firstPickChecked, setFirstPickChecked] = useState(false);
  /** 첫 고르기 여부를 한 번이라도 정했는가. 다시 들어와 기록을 새로 따지는 동안에도 이미 정한 화면을 그대로 둔다. */
  const [pickDecided, setPickDecided] = useState(false);
  /** 첫 목록(오늘의 챌린지 포함)을 한 번이라도 받았는가. 탭을 바꿔 다시 받을 때는 뼈대로 돌아가지 않는다. */
  const [firstLoadDone, setFirstLoadDone] = useState(false);
  const unread = useUnreadNotifications();
  /** 첫 사용자용 고르기(C1.16·C1.18) — 고른 줄. 첫 항목을 미리 골라 두고(UX 가이드 5절, 10/23) 「다음」을 눌러야 넘어간다. */
  const [firstPick, setFirstPick] = useState<'perform' | 'browse' | null>('perform');
  /** 이번 주 대사 카드에 틀어 줄 참여작 예시 영상(지난주 선정작 우선, 없으면 이번 주 좋아요 순). 없으면 카드만 둔다. */

  const load = useCallback(async (next: ChallengeTab) => {
    shownTab.current = next;
    setCursor(null);
    setError(null);
    try {
      const result = await api.listChallenges({ tab: next });
      setCursor(result.next_cursor);
      const { pinned, rest } = pinFeatured(result, featuredRef.current);
      featuredRef.current = pinned;
      setFeatured(pinned);
      setChallenges(rest);
    } catch (e) {
      setChallenges([]);
      setFeatured(null);
      setCursor(null);
      setError(browseFailure(e));
    }
  }, []);

  /** 맨 위에서 당기면 지금 탭을 처음부터 다시 받는다. */
  const [refreshing, setRefreshing] = useState(false);
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load(tab);
    } finally {
      setRefreshing(false);
    }
  }, [load, tab]);

  /** 20개씩 이어 받는다. 커서는 요청자·탭에 묶여 있어 탭을 바꾸면 처음부터 다시 읽는다. */
  const loadMore = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const asked = tab;
      const result = await api.listChallenges({ tab: asked, cursor });
      if (shownTab.current !== asked) return;
      setChallenges((prev) => [...(prev ?? []), ...result.challenges.filter((c) => c.id !== featuredRef.current?.id)]);
      setCursor(result.next_cursor);
    } catch (e) {
      // 순위가 바뀌어 커서가 만료되면 처음부터 다시 읽는다(상세와 같다).
      if (browseFailure(e).kind === 'cursor_expired') void load(tab);
      else setError(browseFailure(e));
    } finally {
      setLoadingMore(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      void load(tab);
    }, [load, tab]),
  );

  // 「지난 챌린지」를 보는 중이면 안드로이드 뒤로가기는 세 구역 화면으로 돌아간다(탭 밖으로 나가지 않는다).
  useFocusEffect(
    useCallback(() => {
      if (tab !== 'ended') return;
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        setTab('popular');
        setChallenges(null);
        return true;
      });
      return () => sub.remove();
    }, [tab]),
  );

  useFocusEffect(
    useCallback(() => {
      // 첫 고르기 화면은 기기 기록으로 정하는데, 앱을 다시 깐 기존 사용자에게도 다시 떴다(10/26). 기기 기록이 비었으면
      // 서버 기록(올린 참여작·「연습 1회」)을 한 번 보고, 이미 써 본 계정이면 고르기 없이 기본 챌린지 홈을 보인다.
      let live = true;
      setFirstPickChecked(false);
      void Promise.all([hasFinishedFirstChallenge(), hasBrowsedChallenges()]).then(async ([done, seenBrowse]) => {
        if (!live) return;
        setShowGuide(!done);
        setBrowsed(seenBrowse);
        if (done || seenBrowse) {
          setFirstPickChecked(true);
          return;
        }
        // 홈이 앱을 켤 때 받은 내 참여작이 있으면 서버에 다시 묻지 않는다(lib/last-reads) — 참여작이 하나라도 있으면 묶음과
        // 상관없이 첫 고르기를 건너뛴다. 비어 있으면 그 뒤에 첫 참여·연습을 했을 수 있어 둘 다 새로 묻는다.
        const sharedEntries = lastRead<MyEntriesResponse>('myChallengeEntries')?.entries;
        const [entries, groups] =
          sharedEntries && sharedEntries.length > 0
            ? [sharedEntries, [] as PracticeGroupDetail[]]
            : await Promise.all([
                Promise.resolve()
                  .then(() => api.listMyChallengeEntries())
                  .then((r) => r.entries)
                  .catch(() => []),
                Promise.resolve()
                  .then(() => api.listPracticeGroups('all'))
                  .then((r) => r.groups)
                  .catch(() => []),
              ]);
        if (!live) return;
        const countedPracticeCount = countedPractices({ groups, entries }).length;
        if (entries.length > 0) {
          void markFirstChallengeFinished();
          setShowGuide(false);
        } else if (skipsChallengeFirstPick({ entryCount: entries.length, countedPracticeCount })) {
          void markChallengesBrowsed();
          setBrowsed(true);
        }
        setFirstPickChecked(true);
      });
      void api
        .listChallenges({ tab: 'ended' })
        .then((result) => setLastWeek(lastWeekResult(result.challenges)))
        .catch(() => setLastWeek(null));
      return () => {
        live = false;
      };
    }, []),
  );

  useEffect(() => {
    if (firstPickChecked) setPickDecided(true);
  }, [firstPickChecked]);
  useEffect(() => {
    if (challenges !== null || error) setFirstLoadDone(true);
  }, [challenges, error]);

  const featuredId = featured?.id ?? null;
  const exampleUrl = useExampleUrl(featuredId);

  const openDetail = (challenge: ChallengeCard) => {
    logEvent('challenge_open_detail', { id: challenge.id });
    router.push({ pathname: '/challenge-detail', params: { id: challenge.id } });
  };
  const perform = (challenge: ChallengeCard) => {
    if (!canPerform(challenge)) return;
    logEvent('challenge_perform_tap', { id: challenge.id });
    router.push({
      pathname: '/record-video',
      params: { mode: 'challenge', challengeId: challenge.id, line: challenge.line, work: challenge.work },
    });
  };
  /** 카드를 누르면 대사 상세로 간다. */
  const tapCard = (challenge: ChallengeCard) => openDetail(challenge);

  /** 첫 챌린지 참여를 끝내기 전에는 이번 주 대사 하나만 보여 주고 둘 중 하나를 고르게 한다. */
  const selectMode = pickDecided && showGuide && !browsed && !!featured && canPerform(featured) && tab !== 'ended';

  // 첫 고르기를 띄울지 정하기 전에는 기본 챌린지 홈을 그리지 않는다 — 첫 사용자에게 홈이 먼저 보였다가 고르기로 바뀌었다(SOMA-932).
  const deciding = !pickDecided || !firstLoadDone;

  // 「지난 챌린지」 — 끝난 챌린지 목록을 같은 화면에서 본다. 머리 꺾쇠로 돌아온다.
  const showingPast = tab === 'ended';
  const switchList = (next: ChallengeTab) => {
    setTab(next);
    setChallenges(null);
  };
  const openPast = () => {
    logEvent('challenge_past_open');
    switchList('ended');
  };
  // 공식(origin team)·배우가 연(member) 진행 중 챌린지로 나눈다(서버 ChallengeCard.origin). 고정한 이번 주 대사는 이미 빠져 있다.
  const running = (challenges ?? []).filter((c) => Date.parse(c.ends_at) > Date.now());
  const official = running.filter((c) => c.origin === 'team');
  const actors = running.filter((c) => c.origin !== 'team');
  const listStatus = (
    <>
      {error && !canRetryBrowse(error) && <InlineEmpty title={browseFailureMessage(error)} />}
      {error && canRetryBrowse(error) && <InlineError message={browseFailureMessage(error)} onRetry={() => void load(tab)} />}
      {challenges === null && !error && <SkeletonRows count={3} avatar={false} style={styles.flush} />}
    </>
  );
  const moreButton = cursor ? (
    <Pressable style={styles.moreBtn} onPress={() => void loadMore()} disabled={loadingMore} accessibilityRole="button">
      {loadingMore ? <LoadingText label={t('loadingText.loading')} /> : <Text style={styles.moreText}>{t('challenges.moreLines')}</Text>}
    </Pressable>
  ) : null;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* 머리 — 「챌린지」 제목(게시판은 SOMA-1121에서 커뮤니티 탭으로 나갔다)과 검색·알림함. 지난 챌린지를 볼 때는 꺾쇠와 그 제목. */}
      <View style={styles.header}>
        {showingPast && (
          <NavIconButton icon="chevron-left" label={t('common.back')} phLabel="challenges_past_back" onPress={() => switchList('popular')} />
        )}
        <Text style={styles.title} accessibilityRole="header">{showingPast ? t('challenges.pastTitle') : t('tabs.challenge')}</Text>
        {!selectMode && !deciding && (
        <View style={styles.headerRight}>
          <Pressable
            style={styles.iconBtn}
            onPress={() => router.push('/line-search')}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={t('challenges.search')}
            ph-label="challenges_search">
            <Feather name="search" size={22} color={palette.text} />
          </Pressable>
          {/* 알림함 — 읽지 않은 묶음이 있으면 점이 붙는다(challenge.notification). */}
          <Pressable
            style={styles.iconBtn}
            onPress={() => router.push('/notifications')}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={t('notifications.title')}
            ph-label="challenges_bell">
            <Feather name="bell" size={22} color={palette.text} />
            {unread.count > 0 && <View style={styles.badgeDot} />}
          </Pressable>
        </View>
        )}
      </View>
      <View style={styles.headerDivider} />

      {deciding ? (
        <SkeletonRows count={4} avatar={false} style={styles.flush} />
      ) : selectMode && featured ? (
        <>
          <ScrollView contentContainerStyle={styles.body} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={palette.blue} />}>
            <ExampleHero challenge={featured} videoUrl={exampleUrl} onOpen={() => openDetail(featured)} />
            <View style={styles.sameHead}>
              <Text style={styles.sameTitle}>{t('challenges.sameLineTitle')}</Text>
              <Text style={styles.sameMeta}>{t('challenges.firstSub')}</Text>
            </View>
            <SelectCard title={t('challenges.performCta')} selected={firstPick === 'perform'} onPress={() => setFirstPick('perform')} />
            <SelectCard title={t('challenges.firstBrowse')} selected={firstPick === 'browse'} onPress={() => setFirstPick('browse')} />
          </ScrollView>
          <CtaBar safeBottom={false} style={{ paddingBottom: tabBarSpace > 0 ? tabBarSpace : space[3] }}>
            <PrimaryButton
              label={t('challenges.firstNext')}
              disabled={!firstPick}
              onPress={() => {
                logEvent('challenge_first_pick', { pick: firstPick ?? '' });
                if (firstPick === 'perform') perform(featured);
                else {
                  // 둘러보기 — 이 자리에서 기본 챌린지 홈으로 바꾸고, 다음에 와도 그대로 둔다.
                  setBrowsed(true);
                  void markChallengesBrowsed();
                }
              }}
            />
          </CtaBar>
        </>
      ) : (
      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: tabBarSpace + FLOATING_ADD_HEIGHT + space[6] }]} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={palette.blue} />}>
        {showingPast ? (
          // 지난 챌린지 — 끝난 챌린지 목록(서버 종료 탭). 머리 꺾쇠로 세 구역 화면에 돌아간다.
          <>
            {listStatus}
            {challenges?.map((challenge) => <Card key={challenge.id} challenge={challenge} onOpen={() => tapCard(challenge)} />)}
            {moreButton}
            {challenges !== null && challenges.length === 0 && !error && <InlineEmpty title={t('challenges.emptyEnded')} />}
          </>
        ) : (
          <>
            {/* ① 이번 주 공식 대사 — 바로 연기하기 버튼과 다른 배우 영상 줄. */}
            {featured && (
              <Rise index={0} testID="challenges-section-week">
                <WeekHero
                  challenge={featured}
                  showGuide={firstTime}
                  onOpen={() => tapCard(featured)}
                  onPerform={canPerform(featured) ? () => perform(featured) : undefined}
                  entered={enteredIds.has(featured.id)}
                />
                <ChallengeOthersRow
                  challenge={featured}
                  onOpenAll={() => {
                    logEvent('challenge_others_row_all', { id: featured.id });
                    openDetail(featured);
                  }}
                  onOpenEntry={(entry) => {
                    logEvent('challenge_others_row_open', { id: featured.id, entry_id: entry.id });
                    router.push({ pathname: '/challenge-play', params: { id: featured.id, entryId: entry.id } });
                  }}
                />
              </Rise>
            )}

            <AdSlot slot="challenges_tab_top" />

            {/* ② 공식 챌린지 — 진행 중인 공식 대사와 지난 결과·지난 챌린지로 가는 길. */}
            <Rise index={1} testID="challenges-section-official">
              <View style={styles.sectionHead}>
                <Text style={styles.sectionTitle} accessibilityRole="header">{t('challenges.sectionOfficial')}</Text>
                <Pressable onPress={openPast} hitSlop={8} accessibilityRole="link" ph-label="challenges_past">
                  <Text style={styles.sectionLink}>{t('challenges.pastLink')}</Text>
                </Pressable>
              </View>
              {lastWeek && (
                <Pressable
                  style={({ pressed }) => [styles.banner, pressed && styles.pressed]}
                  onPress={() => {
                    logEvent('challenge_last_week_open', { id: lastWeek.id });
                    router.push({ pathname: '/challenge-result', params: { id: lastWeek.id, nextId: featured?.id ?? '' } });
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={t('challenges.resultBanner')}>
                  <Feather name="award" size={20} color={palette.flame} />
                  <View style={styles.flex}>
                    <Text style={styles.bannerTitle}>{t('challenges.resultBanner')}</Text>
                    <Text style={styles.bannerSub}>
                      {t('challenges.resultBannerSub', { count: Math.min(3, lastWeek.entry_count) })}
                    </Text>
                  </View>
                  <Feather name="chevron-right" size={20} color={palette.iconFaint} />
                </Pressable>
              )}
              {official.map((challenge) => (
                <Card key={challenge.id} challenge={challenge} onOpen={() => tapCard(challenge)} />
              ))}
            </Rise>

            {/* ③ 배우들이 연 챌린지 — 연 사람·참여 수·남은 날. */}
            <Rise index={2} testID="challenges-section-actors">
              <View style={styles.sectionHead}>
                <Text style={styles.sectionTitle} accessibilityRole="header">{t('challenges.sectionActors')}</Text>
              </View>
              {listStatus}
              {actors.map((challenge) => (
                <Card key={challenge.id} challenge={challenge} onOpen={() => tapCard(challenge)} />
              ))}
              {moreButton}
              {challenges !== null && actors.length === 0 && !error && <InlineEmpty title={t('challenges.emptyActors')} />}
            </Rise>
          </>
        )}
      </ScrollView>
      )}
      {!selectMode && !deciding && !showingPast && (
        <FloatingAdd
          label={t('challenges.addLine')}
          bottom={floatingAddBottom}
          phLabel="challenges_add_line"
          onPress={() => router.push('/line-new')}
        />
      )}
    </SafeAreaView>
  );
}

function Avatars({ participants, border }: { participants: ChallengeCard['participants']; border: string }) {
  if (participants.length === 0) return null;
  return (
    <View style={styles.avatars}>
      {participants.slice(0, 3).map((p, i) => (
        <View key={`${p.user_id}-${i}`} style={[styles.avatar, { borderColor: border }]}>
          <UserAvatar size={20} radius={10} seed={p.user_id} photoUrl={p.photo_url} />
        </View>
      ))}
    </View>
  );
}

/**
 * 이번 주 대사 카드(pen C1.2 grFk4·C1.13·C1.14) — 파란 그라데이션 위에 「⚡ 공식 · 이번 주 대사 · D-N」 알약, 대사, 작품·인물,
 * 참여자 아바타와 참여작·좋아요, 흰 「나도 이 대사 연기하기」. 카드를 누르면 대사 상세로 간다. 인기·최신 탭에서만 띄운다.
 * 버튼 위 한 줄 안내는 첫 사용자(C1.16 gRFTy)에게만 보인다.
 */
function WeekHero({
  challenge,
  showGuide,
  onOpen,
  onPerform,
  entered = false,
}: {
  challenge: ChallengeCard;
  showGuide: boolean;
  onOpen: () => void;
  onPerform?: () => void;
  /** 이미 참여했는가(나만 보기 포함) — 버튼을 「한 번 더 찍기」로 둔다. */
  entered?: boolean;
}) {
  const meta = [challenge.work, challenge.character].filter(Boolean).join(' · ');
  return (
    // 10/29 시안 — 진한 파랑 카드, 노란 번개가 든 남색 알약, 오른쪽 아래 슬레이트 든 액티, 아래 흰 알약 [나도 이 대사 연기하기].
    // 카드 어디를 눌러도(액티·여백 포함) 상세로 간다 — 예전엔 왼쪽 글자 묶음(68%)만 눌렸다. 흰 알약은 안쪽 Pressable 이라 따로 눌린다.
    // 바깥은 접근성에서 빼고(안쪽 버튼이 묶여 사라지지 않게) 글자 묶음을 「열기」 버튼으로 읽게 한다.
    <Pressable style={styles.weekHero} onPress={onOpen} accessible={false}>
      <Image source={MASCOT.slate} style={[styles.weekActy, !onPerform && styles.weekActyLow]} contentFit="contain" cachePolicy="memory-disk" accessibilityElementsHidden />
      <View
        style={styles.weekHeroTop}
        accessible
        accessibilityRole="button"
        accessibilityActions={[{ name: 'activate' }]}
        onAccessibilityAction={(e) => e.nativeEvent.actionName === 'activate' && onOpen()}>
        <View style={styles.weekChip}>
          <Feather name="zap" size={13} color={heroCard.bolt} />
          <Text style={styles.heroChipText}>
            {`${challenge.origin === 'team' ? t('challenges.weekLabel') : t('challenges.featuredLabel')} · ${dDayLabel(challenge)}`}
          </Text>
        </View>
        <Text style={styles.weekLine} numberOfLines={3}>
          “{challenge.line}”
        </Text>
        {!!meta && (
          <Text style={styles.heroMeta} numberOfLines={1}>
            {meta}
          </Text>
        )}
        <View style={styles.statRow}>
          <Avatars participants={challenge.participants} border={heroCard.bg} />
          <Text style={styles.heroStat} numberOfLines={1}>
            {t('challenges.entryCount', { count: challenge.entry_count })} · {t('challenges.likeSum', { count: challenge.like_sum })}
          </Text>
        </View>
      </View>
      {onPerform && showGuide && <Text style={styles.heroGuide}>{t('challenges.heroGuidePerform')}</Text>}
      {onPerform && (
        <Pressable
          style={styles.heroPerform}
          onPress={onPerform}
          accessibilityRole="button"
          accessibilityLabel={t(entered ? 'challenges.performAgainCta' : 'challenges.performCta')}>
          {/* 흰 알약 버튼(10/29 시안). */}
          <Feather name="video" size={18} color={heroCard.ctaNavy} />
          <Text style={styles.heroPerformText}>{t(entered ? 'challenges.performAgainCta' : 'challenges.performCta')}</Text>
          <View style={styles.heroPerformArrow}>
            <Feather name="arrow-right" size={16} color={palette.onAccent} />
          </View>
        </Pressable>
      )}
    </Pressable>
  );
}

/**
 * 첫 사용자 고르기 화면의 이번 주 대사 카드(pen C1.16 옆 g06vYS) — 참여작 예시 영상을 깔고 「참여작 예시」 알약과 대사를 얹는다.
 * 영상이 없으면 짙은 파랑 카드에 대사만 둔다. 카드를 누르면 대사 상세로 간다.
 */
function ExampleHero({ challenge, videoUrl, onOpen }: { challenge: ChallengeCard; videoUrl: string | null; onOpen: () => void }) {
  const player = useVideoPlayer(videoUrl, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });
  /** 첫 장면이 그려지기 전의 VideoView 는 검은 상자다 — 그려질 때까지 숨겨 카드 바탕(파랑)만 보이게 한다. */
  const [frameReady, setFrameReady] = useState(false);
  useEffect(() => setFrameReady(false), [videoUrl]);
  return (
    // 카드 전체(가장자리 여백 포함)가 눌린다. 영상은 터치를 가로채지 않게 pointerEvents="none".
    <Pressable style={styles.hero} onPress={onOpen} accessibilityRole="button">
      {!!videoUrl && (
        <VideoView
          style={[StyleSheet.absoluteFill, { opacity: frameReady ? 1 : 0 }]}
          player={player}
          contentFit="cover"
          nativeControls={false}
          pointerEvents="none"
          onFirstFrameRender={() => setFrameReady(true)}
        />
      )}
      <View style={styles.heroScrim} pointerEvents="none" />
      <View style={styles.heroTop}>
        <View style={styles.heroChip}>
          <Text style={styles.heroChipText}>
            {videoUrl ? t('challenges.exampleChip') : `${challenge.origin === 'team' ? t('challenges.weekLabel') : t('challenges.featuredLabel')} · ${dDayLabel(challenge)}`}
          </Text>
        </View>
        <Text style={styles.heroLine} numberOfLines={4}>
          “{challenge.line}”
        </Text>
      </View>
    </Pressable>
  );
}

/** 줄 카드(ZxMmEh) — 아이콘 · 대사 · "주최 · 참여작 · D-N", 그 아래 참여자와 좋아요 합. */
function Card({
  challenge,
  onOpen,
}: {
  challenge: ChallengeCard;
  onOpen: () => void;
}) {
  // 배우가 연 챌린지는 연 사람 이름을 보인다(SOMA-1122). 탈퇴했으면 이름 없이 「주최자 탈퇴」.
  const host =
    challenge.origin === 'team'
      ? t('challenges.hostTeam')
      : challenge.host_name?.trim()
        ? t('challenges.hostMember', { name: challenge.host_name.trim() })
        : t('challenges.hostWithdrawn');
  return (
    // 카드 전체(테두리 안 여백 포함)가 눌린다 — 예전엔 여백 안쪽 글자 영역만 눌렸다.
    <Pressable style={({ pressed }) => [styles.row, pressed && styles.pressed]} onPress={onOpen} accessibilityRole="button">
      <View style={styles.rowMain}>
        <View style={styles.rowBody}>
          <Text style={styles.line} numberOfLines={3}>
            “{challenge.line}”
          </Text>
          <View style={styles.metaRow}>
            <Feather name={challenge.origin === 'team' ? 'check-circle' : 'user'} size={13} color={palette.iconFaint} />
            <Text style={styles.meta} numberOfLines={1}>
              {host} · {t('challenges.entryCount', { count: challenge.entry_count })} · {dDayLabel(challenge)}
            </Text>
          </View>
          <View style={styles.statRow}>
            <Feather name="message-circle" size={16} color={palette.iconFaint} />
            <Avatars participants={challenge.participants} border={palette.onAccent} />
            <Text style={styles.names} numberOfLines={1}>
              {participantsLabel(challenge.participants, challenge.more_count)}
            </Text>
            <View style={styles.likes}>
              <Feather name="heart" size={12} color={palette.iconFaint} />
              <Text style={styles.names}>{t('challenges.likeSum', { count: challenge.like_sum })}</Text>
            </View>
          </View>
        </View>
      </View>
      {/* 목록 카드 안에는 「나도 이 대사 연기하기」 버튼을 두지 않는다 — 카드를 누르면 챌린지 화면에서 찍는다(UX 가이드 5절 「카드 안 버튼 금지」). */}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  flush: { paddingHorizontal: 0 },
  pressed: { opacity: 0.7 },
  moreBtn: { alignItems: 'center', paddingVertical: space[3] },
  moreText: { ...type.body2Bold, color: palette.blueDeep },
  safe: { flex: 1, backgroundColor: palette.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 56,
    paddingHorizontal: space.gutter,
  },
  title: { ...type.title2, flex: 1, color: palette.text },
  headerDivider: { height: 1, backgroundColor: palette.border },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: space[4] },
  iconBtn: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  badgeDot: {
    position: 'absolute',
    top: 1,
    right: 1,
    width: 8,
    height: 8,
    borderRadius: radius.full,
    backgroundColor: palette.danger,
  },
  body: { paddingHorizontal: space.gutter, paddingTop: space[1.5], gap: space[3] },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    padding: space[4],
    borderRadius: radius.lg,
    backgroundColor: palette.flameSoft,
  },
  bannerTitle: { ...type.body2Bold, color: palette.text },
  bannerSub: { ...type.caption, color: palette.textMeta, marginTop: space[1] },
  // 아래에 「다른 배우 영상」 줄이 붙어도 다른 챌린지가 첫 화면에 보이게 한 단계씩 줄였다(SOMA-986, 11/2 시안).
  weekHero: { backgroundColor: heroCard.bg, borderRadius: radius.xl, padding: space[4], gap: space[2], overflow: 'hidden' },
  weekHeroTop: { gap: space[2], maxWidth: '72%' },
  weekActy: { position: 'absolute', right: -space[1.5], bottom: 48 + space[4], width: 104, height: 96 },
  weekActyLow: { bottom: 2 },
  weekChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
    alignSelf: 'flex-start',
    backgroundColor: heroCard.chipNavy,
    borderRadius: radius.full,
    paddingHorizontal: space[3],
    paddingVertical: space[1.5],
  },
  weekLine: { ...type.title2, color: palette.onAccent },
  names: { ...type.caption, color: palette.textMeta, flexShrink: 1 },
  likes: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  hero: { backgroundColor: palette.blue, borderRadius: radius.lg, padding: space[5], minHeight: 300, gap: space[3], justifyContent: 'flex-end', overflow: 'hidden' },
  heroTop: { flex: 1, gap: space[3], justifyContent: 'flex-end' },
  heroGuide: { ...type.body2Bold, color: palette.onMediaSub },
  heroMeta: { ...type.caption, color: palette.onMediaSub },
  heroStat: { ...type.caption, color: palette.onMediaSub },
  heroPerform: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space[2], height: 48, borderRadius: radius.full, marginTop: 2, backgroundColor: palette.bg },
  heroPerformArrow: { position: 'absolute', right: space[2], width: 32, height: 32, borderRadius: radius.full, backgroundColor: heroCard.ctaNavy, alignItems: 'center', justifyContent: 'center' },
  heroPerformText: { ...type.headline, color: heroCard.ctaNavy },
  heroScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: palette.scrim },
  sameHead: { gap: space[1], marginTop: space[1.5] },
  sameTitle: { ...type.title2, color: palette.text },
  sameMeta: { ...type.caption, color: palette.textMeta },
  heroChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1.5],
    alignSelf: 'flex-start',
    backgroundColor: palette.scrim,
    borderRadius: radius.full,
    paddingHorizontal: space[3],
    paddingVertical: space[1.5],
  },
  heroChipText: { ...type.micro, color: palette.onAccent },
  heroLine: { ...type.headline, fontWeight: '700', color: palette.onAccent, marginTop: 'auto' },
  section: { gap: space[3] },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: space[2] },
  sectionTitle: { ...type.headline, color: palette.text },
  sectionLink: { ...type.body2Bold, color: palette.blueDeep },
  row: { borderRadius: radius.lg, gap: space[3], padding: space[4], backgroundColor: palette.bg, borderWidth: 1, borderColor: palette.border },
  rowMain: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  rowBody: { flex: 1, minWidth: 0, gap: space[2] },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  line: { ...type.headline, fontWeight: '700', color: palette.text },
  meta: { ...type.caption, flex: 1, color: palette.textMeta },
  statRow: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  avatars: { flexDirection: 'row' },
  avatar: {
    width: 22,
    height: 22,
    borderRadius: radius.full,
    overflow: 'hidden',
    marginRight: -space[1.5],
    borderWidth: 1,
  },
});
