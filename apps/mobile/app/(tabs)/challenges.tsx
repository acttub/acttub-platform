import Feather from '@expo/vector-icons/Feather';
import { useFocusEffect, useRouter } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AdSlot } from '@/components/ad-slot';
import { PrimaryButton } from '@/components/ui/buttons';
import { Checkbox } from '@/components/ui/checkbox';
import { Chip } from '@/components/ui/chip';
import { CtaBar } from '@/components/ui/cta-bar';
import { defaultAvatarColor } from '@/components/ui/default-avatar';
import { InlineEmpty } from '@/components/ui/inline-empty';
import { InlineError, InlineErrorLine } from '@/components/ui/inline-error';
import { SkeletonRows } from '@/components/ui/skeleton';
import { NavIconButton } from '@/components/ui/nav-header';
import { useTabBarSpace } from '@/components/ui/tab-bar';
import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';
import { useFirstTimeUser } from '@/hooks/use-first-time-user';
import { logEvent } from '@/lib/analytics';
import { api } from '@/lib/api';
import {
  avatarLetter,
  browseFailure,
  browseFailureMessage,
  canPerform,
  canRetryBrowse,
  dDayLabel,
  participantsLabel,
  pinsFeatured,
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
import { lastWeekResult } from '@/lib/challenge/week-result';
import { useUnreadNotifications } from '@/hooks/use-unread-notifications';
import type { ChallengeCard, ChallengeTab } from '@/lib/challenge/types';
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
 */
const TABS: { key: ChallengeTab; label: string }[] = [
  { key: 'popular', label: 'challenges.tabPopular' },
  { key: 'latest', label: 'challenges.tabLatest' },
  { key: 'ended', label: 'challenges.tabEnded' },
  { key: 'mine', label: 'challenges.tabMineShort' },
];

export default function ChallengesScreen() {
  const tabBarSpace = useTabBarSpace();
  const router = useRouter();
  const firstTime = useFirstTimeUser();
  const [tab, setTab] = useState<ChallengeTab>('popular');
  const [featured, setFeatured] = useState<ChallengeCard | null>(null);
  const [challenges, setChallenges] = useState<ChallengeCard[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  /** 지금 보이는 탭. 이어 받는 중에 탭을 바꾸면 늦게 온 옛 탭의 결과를 버린다. */
  const shownTab = useRef<ChallengeTab>('popular');
  const [error, setError] = useState<BrowseFailure | null>(null);
  /** 지난주 결과 띠 — 끝난 지 7일 안의 공식 챌린지. 못 읽으면 띠만 없다. */
  const [lastWeek, setLastWeek] = useState<ChallengeCard | null>(null);
  /** 파란 「누를 것 안내」는 첫 챌린지 참여를 끝낼 때까지만. */
  const [showGuide, setShowGuide] = useState(false);
  /** 첫 챌린지 화면에서 「챌린지 둘러보기」를 고른 적이 있으면 기본 챌린지 홈을 보인다(SOMA-827). */
  const [browsed, setBrowsed] = useState(false);
  /** 첫 고르기 화면을 띄울지 기기·서버 기록으로 다 따져 봤는가. 따지기 전에는 띄우지 않는다. */
  const [firstPickChecked, setFirstPickChecked] = useState(false);
  const unread = useUnreadNotifications();
  /** 첫 사용자용 고르기(C1.16·C1.18) — 고른 줄. 기본 선택은 없고 「다음」을 눌러야 넘어간다. */
  const [firstPick, setFirstPick] = useState<'perform' | 'browse' | null>(null);
  /** 이번 주 대사 카드에 틀어 줄 참여작 예시 영상(좋아요 많은 순 첫 공개 참여작). 없으면 카드만 둔다. */
  const [exampleUrl, setExampleUrl] = useState<string | null>(null);

  const load = useCallback(async (next: ChallengeTab) => {
    shownTab.current = next;
    setCursor(null);
    setError(null);
    try {
      const result = await api.listChallenges({ tab: next });
      // 진행 중인 공식(팀) 챌린지가 늘 맨 위다 — 같은 무리 안의 순서는 서버 순서를 지킨다.
      const openTeam = (c: ChallengeCard) => c.origin === 'team' && Date.parse(c.ends_at) > Date.now();
      const teamFirst = [...result.challenges].sort((a, b) => Number(openTeam(b)) - Number(openTeam(a)));
      setChallenges(teamFirst);
      setCursor(result.next_cursor);
      // 오늘의 챌린지는 인기·최신 탭에만 고정한다(pinsFeatured(next) ? result.featured : null 이 기본).
      // 서버가 고른 게 회원 챌린지인데 진행 중인 공식 챌린지가 있으면 공식을 올린다.
      const officialPick = result.featured && !openTeam(result.featured) ? (teamFirst.find(openTeam) ?? result.featured) : result.featured;
      setFeatured(pinsFeatured(next) ? officialPick : null);
    } catch (e) {
      setChallenges([]);
      setFeatured(null);
      setCursor(null);
      setError(browseFailure(e));
    }
  }, []);

  /** 20개씩 이어 받는다. 커서는 요청자·탭에 묶여 있어 탭을 바꾸면 처음부터 다시 읽는다. */
  const loadMore = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const asked = tab;
      const result = await api.listChallenges({ tab: asked, cursor });
      if (shownTab.current !== asked) return;
      setChallenges((prev) => [...(prev ?? []), ...result.challenges]);
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
        const [entries, groups] = await Promise.all([
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

  const featuredId = featured?.id ?? null;
  useEffect(() => {
    setExampleUrl(null);
    if (!featuredId) return;
    let alive = true;
    void api
      .listChallengeEntries(featuredId, { sort: 'likes' })
      .then((list) => alive && setExampleUrl(list.entries.find((e) => e.playback_url)?.playback_url ?? null))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [featuredId]);

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
  const selectMode = firstPickChecked && showGuide && !browsed && !!featured && canPerform(featured) && tab !== 'ended' && tab !== 'mine';

  const emptyText =
    tab === 'ended' ? t('challenges.emptyEnded') : tab === 'mine' ? t('challenges.emptyMine') : t('challenges.emptyRunning');

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        {/* 첫 사용자는 탭바가 숨으므로 홈(뭐부터 해 볼까요?)으로 돌아갈 꺾쇠를 단다 — 탭바가 보이면 두지 않는다. */}
        {firstTime && (
          <NavIconButton icon="chevron-left" label={t('common.back')} phLabel="challenges_back_home" onPress={() => router.navigate('/')} />
        )}
        <Text style={[styles.title, styles.titleGrow]}>{t('challenges.title')}</Text>
        {!selectMode && (
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
          <Pressable
            style={styles.iconBtn}
            onPress={() => router.push('/line-new')}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={t('challenges.addLine')}
            ph-label="challenges_add_line">
            <Feather name="plus" size={22} color={palette.text} />
          </Pressable>
        </View>
        )}
      </View>

      {selectMode && featured ? (
        <>
          <ScrollView contentContainerStyle={styles.body}>
            <ExampleHero challenge={featured} videoUrl={exampleUrl} onOpen={() => openDetail(featured)} />
            <View style={styles.sameHead}>
              <Text style={styles.sameTitle}>{t('challenges.sameLineTitle')}</Text>
              <Text style={styles.sameMeta}>{t('challenges.firstSub')}</Text>
            </View>
            <PickRow label={t('challenges.performCta')} selected={firstPick === 'perform'} onPress={() => setFirstPick('perform')} />
            <PickRow label={t('challenges.firstBrowse')} selected={firstPick === 'browse'} onPress={() => setFirstPick('browse')} />
          </ScrollView>
          <CtaBar safeBottom={false} style={{ paddingBottom: tabBarSpace > 0 ? tabBarSpace : space[3] }}>
            <PrimaryButton
              label={t('challenges.firstNext')}
              disabled={!firstPick}
              onPress={() => {
                void logEvent('challenge_first_pick', { pick: firstPick ?? '' });
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
      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: tabBarSpace + 20 }]}>
        {lastWeek && (
          <Pressable
            style={({ pressed }) => [styles.banner, pressed && styles.pressed]}
            onPress={() => {
              void logEvent('challenge_last_week_open', { id: lastWeek.id });
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

        {featured && (
          <WeekHero
            challenge={featured}
            showGuide={firstTime}
            onOpen={() => tapCard(featured)}
            onPerform={canPerform(featured) ? () => perform(featured) : undefined}
          />
        )}

        <AdSlot slot="challenges_tab_top" />

        <View style={styles.tabRow}>
          {TABS.map(({ key, label }) => (
            <Chip
              key={key}
              label={t(label)}
              role="radio"
              selected={tab === key}
              size="sm"
              phLabel={`challenge_tab_${key}`}
              onPress={() => {
                setTab(key);
                setChallenges(null);
                logEvent('challenge_tab', { tab: key });
              }}
            />
          ))}
        </View>

        {error && !canRetryBrowse(error) && <InlineErrorLine message={browseFailureMessage(error)} />}
        {error && canRetryBrowse(error) && <InlineError message={browseFailureMessage(error)} onRetry={() => void load(tab)} />}
        {challenges === null && !error && <SkeletonRows count={4} avatar={false} style={styles.flush} />}

        {challenges?.map((challenge) => (
          <Card
            key={challenge.id}
            challenge={challenge}
            onOpen={() => tapCard(challenge)}
            onPerform={() => perform(challenge)}
          />
        ))}

        {cursor && (
          <Pressable style={styles.moreBtn} onPress={() => void loadMore()} disabled={loadingMore} accessibilityRole="button">
            {loadingMore ? (
              <ActivityIndicator color={palette.iconFaint} accessibilityLabel={t('loadingText.loading')} />
            ) : (
              <Text style={styles.moreText}>{t('challenges.moreLines')}</Text>
            )}
          </Pressable>
        )}

        {challenges !== null && challenges.length === 0 && !featured && !error && (
          <InlineEmpty title={emptyText} />
        )}

        {tab !== 'mine' && (
          <Pressable style={styles.registerBtn} onPress={() => router.push('/line-new')} accessibilityRole="button">
            <Feather name="plus" size={16} color={palette.blueDeep} />
            <Text style={styles.registerText}>{t('challenges.registerCta')}</Text>
          </Pressable>
        )}
      </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Avatars({ participants, border }: { participants: ChallengeCard['participants']; border: string }) {
  if (participants.length === 0) return null;
  return (
    <View style={styles.avatars}>
      {participants.slice(0, 3).map((p, i) => (
        <View key={`${p.name}-${i}`} style={[styles.avatar, { backgroundColor: defaultAvatarColor(p.name), borderColor: border }]}>
          <Text style={styles.avatarText}>{avatarLetter(p.name)}</Text>
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
}: {
  challenge: ChallengeCard;
  showGuide: boolean;
  onOpen: () => void;
  onPerform?: () => void;
}) {
  const meta = [challenge.work, challenge.character].filter(Boolean).join(' · ');
  return (
    <View style={styles.weekHero}>
      <Pressable style={styles.weekHeroTop} onPress={onOpen} accessibilityRole="button">
        <View style={styles.weekChip}>
          <Feather name="zap" size={12} color={palette.onAccent} />
          <Text style={styles.heroChipText}>
            {`${challenge.origin === 'team' ? t('challenges.weekLabel') : t('challenges.featuredLabel')} · ${dDayLabel(challenge)}`}
          </Text>
        </View>
        <Text style={styles.weekLine} numberOfLines={4}>
          “{challenge.line}”
        </Text>
        {!!meta && (
          <Text style={styles.heroMeta} numberOfLines={1}>
            {meta}
          </Text>
        )}
        <View style={styles.statRow}>
          <Avatars participants={challenge.participants} border={palette.blue} />
          <Text style={styles.heroStat} numberOfLines={1}>
            {t('challenges.entryCount', { count: challenge.entry_count })} · {t('challenges.likeSum', { count: challenge.like_sum })}
          </Text>
        </View>
      </Pressable>
      {onPerform && showGuide && <Text style={styles.heroGuide}>{t('challenges.heroGuidePerform')}</Text>}
      {onPerform && (
        <Pressable
          style={styles.heroPerform}
          onPress={onPerform}
          accessibilityRole="button"
          accessibilityLabel={t('challenges.performCta')}>
          <View style={styles.heroPerformSpacer} />
          <View style={styles.heroPerformLabel}>
            <Feather name="video" size={18} color={palette.text} />
            <Text style={styles.heroPerformText}>{t('challenges.performCta')}</Text>
          </View>
          <View style={styles.heroGo}>
            <Feather name="chevron-right" size={18} color={palette.blue} />
          </View>
        </Pressable>
      )}
    </View>
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
    <View style={styles.hero}>
      {!!videoUrl && (
        <VideoView
          style={[StyleSheet.absoluteFill, { opacity: frameReady ? 1 : 0 }]}
          player={player}
          contentFit="cover"
          nativeControls={false}
          onFirstFrameRender={() => setFrameReady(true)}
        />
      )}
      <View style={styles.heroScrim} pointerEvents="none" />
      <Pressable style={styles.heroTop} onPress={onOpen} accessibilityRole="button">
        <View style={styles.heroChip}>
          <Text style={styles.heroChipText}>
            {videoUrl ? t('challenges.exampleChip') : `${challenge.origin === 'team' ? t('challenges.weekLabel') : t('challenges.featuredLabel')} · ${dDayLabel(challenge)}`}
          </Text>
        </View>
        <Text style={styles.heroLine} numberOfLines={4}>
          “{challenge.line}”
        </Text>
      </Pressable>
    </View>
  );
}

/** 첫 사용자 고르기 줄(C1.16) — 고르면 연파랑 바탕·파란 테두리·오른쪽 체크. */
function PickRow({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      style={[styles.pick, selected && styles.pickOn]}
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ selected }}>
      <Text style={[styles.pickText, selected && styles.pickTextOn]}>{label}</Text>
      {selected && <Checkbox checked />}
    </Pressable>
  );
}

/** 줄 카드(ZxMmEh) — 아이콘 · 대사 · "주최 · 참여작 · D-N", 그 아래 참여자와 좋아요 합. */
function Card({
  challenge,
  onOpen,
  onPerform,
}: {
  challenge: ChallengeCard;
  onOpen: () => void;
  onPerform: () => void;
}) {
  const host = challenge.origin === 'team' ? t('challenges.hostTeam') : t('challenges.hostMemberShort');
  return (
    <View style={styles.row}>
      <Pressable style={({ pressed }) => [styles.rowMain, pressed && styles.pressed]} onPress={onOpen} accessibilityRole="button">
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
              <Feather name="heart" size={12} color={palette.danger} />
              <Text style={styles.names}>{t('challenges.likeSum', { count: challenge.like_sum })}</Text>
            </View>
          </View>
        </View>
      </Pressable>
      {canPerform(challenge) && (
        <Pressable style={styles.performBtn} onPress={onPerform} accessibilityRole="button" accessibilityLabel={t('challenges.performCta')}>
          <View style={styles.heroPerformSpacer} />
          <View style={styles.heroPerformLabel}>
            <Feather name="video" size={18} color={palette.blueDeep} />
            <Text style={styles.performText}>{t('challenges.performCta')}</Text>
          </View>
          <View style={styles.performGo}>
            <Feather name="chevron-right" size={18} color={palette.blueDeep} />
          </View>
        </Pressable>
      )}
    </View>
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
    height: 72,
    paddingHorizontal: space.gutter,
  },
  title: { ...type.display, color: palette.text },
  titleGrow: { flex: 1 },
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
  weekHero: { backgroundColor: palette.blue, borderRadius: radius.lg, padding: space[5], gap: space[3] },
  weekHeroTop: { gap: space[2] },
  weekChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
    alignSelf: 'flex-start',
    backgroundColor: palette.blueDeep,
    borderRadius: radius.full,
    paddingHorizontal: space[2],
    paddingVertical: space[1],
  },
  weekLine: { ...type.headline, fontWeight: '700', color: palette.onAccent },
  names: { ...type.caption, color: palette.textMeta, flexShrink: 1 },
  likes: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  hero: { backgroundColor: palette.blue, borderRadius: radius.lg, padding: space[5], minHeight: 300, gap: space[3], justifyContent: 'flex-end', overflow: 'hidden' },
  heroTop: { flex: 1, gap: space[3], justifyContent: 'flex-end' },
  heroGuide: { ...type.body2Bold, color: palette.onMediaSub },
  heroMeta: { ...type.caption, color: palette.onMediaSub },
  heroStat: { ...type.caption, color: palette.onMediaSub },
  heroPerform: { flexDirection: 'row', alignItems: 'center', height: 48, borderRadius: radius.full, paddingHorizontal: space[1.5], backgroundColor: palette.onAccent },
  heroPerformSpacer: { width: 32, height: 32 },
  heroPerformLabel: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space[2] },
  heroPerformText: { ...type.headline, color: palette.text },
  heroGo: { width: 32, height: 32, borderRadius: radius.full, backgroundColor: palette.blueSoft, alignItems: 'center', justifyContent: 'center' },
  heroScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: palette.scrim },
  sameHead: { gap: space[1], marginTop: space[1.5] },
  sameTitle: { ...type.title2, color: palette.text },
  sameMeta: { ...type.caption, color: palette.textMeta },
  pick: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: radius.lg, borderWidth: 1, borderColor: palette.border, paddingVertical: space[4], paddingHorizontal: space[4] },
  pickOn: { backgroundColor: palette.blueSoft, borderColor: palette.blue, borderWidth: 1.5, paddingHorizontal: space[4] - 0.5, paddingVertical: space[4] - 0.5 },
  pickText: { ...type.body1Bold, color: palette.text },
  pickTextOn: { color: palette.blueDeep },
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
  tabRow: { flexDirection: 'row', gap: space[1.5], paddingTop: space[1] },
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
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: -space[1.5],
    borderWidth: 1,
  },
  avatarText: { ...type.micro, color: palette.text },
  performBtn: { flexDirection: 'row', alignItems: 'center', height: 48, borderRadius: radius.full, paddingHorizontal: space[1.5], backgroundColor: palette.blueSoft },
  performGo: { width: 32, height: 32, borderRadius: radius.full, backgroundColor: palette.onAccent, alignItems: 'center', justifyContent: 'center' },
  performText: { ...type.headline, color: palette.blueDeep },
  registerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[1.5],
    backgroundColor: palette.blueSoft,
    borderRadius: radius.md,
    paddingVertical: space[3],
  },
  registerText: { ...type.body2Bold, color: palette.blueDeep },
});
