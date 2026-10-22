import Feather from '@expo/vector-icons/Feather';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ChallengeIntro } from '@/components/challenge-intro';
import { NavIconButton } from '@/components/ui/nav-header';
import { useTabBarSpace } from '@/components/ui/tab-bar';
import { palette } from '@/constants/palette';
import { useFirstTimeUser } from '@/hooks/use-first-time-user';
import { logEvent } from '@/lib/analytics';
import { api } from '@/lib/api';
import {
  avatarLetter,
  browseFailure,
  browseFailureMessage,
  canPerform,
  dDayLabel,
  participantsLabel,
  pinsFeatured,
} from '@/lib/challenge/browse';
import { hasFinishedFirstChallenge, hasSeenChallengeIntro, markChallengeIntroSeen } from '@/lib/challenge/intro-state';
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
  // 보관함에서 "챌린지에 올리기"로 오면 올릴 챌린지를 고르는 화면이 된다(A2.3 → A18.1).
  const { pickVideoId } = useLocalSearchParams<{ pickVideoId?: string }>();
  const picking = typeof pickVideoId === 'string' && pickVideoId.length > 0;
  const [tab, setTab] = useState<ChallengeTab>('popular');
  const [featured, setFeatured] = useState<ChallengeCard | null>(null);
  const [challenges, setChallenges] = useState<ChallengeCard[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  /** 지금 보이는 탭. 이어 받는 중에 탭을 바꾸면 늦게 온 옛 탭의 결과를 버린다. */
  const shownTab = useRef<ChallengeTab>('popular');
  const [error, setError] = useState<string | null>(null);
  const [intro, setIntro] = useState(false);
  /** 지난주 결과 띠 — 끝난 지 7일 안의 공식 챌린지. 못 읽으면 띠만 없다. */
  const [lastWeek, setLastWeek] = useState<ChallengeCard | null>(null);
  /** 파란 「누를 것 안내」는 첫 챌린지 참여를 끝낼 때까지만. */
  const [showGuide, setShowGuide] = useState(false);
  const unread = useUnreadNotifications();

  const load = useCallback(async (next: ChallengeTab) => {
    shownTab.current = next;
    setCursor(null);
    setError(null);
    try {
      const result = await api.listChallenges({ tab: next });
      setChallenges(result.challenges);
      setCursor(result.next_cursor);
      // 오늘의 챌린지는 인기·최신 탭에만 고정한다.
      setFeatured(pinsFeatured(next) ? result.featured : null);
    } catch (e) {
      setChallenges([]);
      setFeatured(null);
      setCursor(null);
      setError(browseFailureMessage(browseFailure(e)));
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
      setError(browseFailureMessage(browseFailure(e)));
    } finally {
      setLoadingMore(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      void load(tab);
      void hasSeenChallengeIntro().then((seen) => setIntro(!seen));
    }, [load, tab]),
  );

  useFocusEffect(
    useCallback(() => {
      void hasFinishedFirstChallenge().then((done) => setShowGuide(!done));
      if (picking) return;
      void api
        .listChallenges({ tab: 'ended' })
        .then((result) => setLastWeek(lastWeekResult(result.challenges)))
        .catch(() => setLastWeek(null));
    }, [picking]),
  );

  const openDetail = (challenge: ChallengeCard) => {
    logEvent('challenge_open_detail', { id: challenge.id });
    router.push({ pathname: '/challenge-detail', params: { id: challenge.id } });
  };
  const perform = (challenge: ChallengeCard) => {
    if (!canPerform(challenge)) return;
    if (picking) {
      // 고른 영상을 그 챌린지 올리기 화면으로 보낸다.
      logEvent('challenge_pick_for_video', { id: challenge.id });
      router.replace({
        pathname: '/challenge-upload',
        params: { challengeId: challenge.id, videoId: pickVideoId as string },
      });
      return;
    }
    logEvent('challenge_perform_tap', { id: challenge.id });
    router.push({
      pathname: '/record-video',
      params: { mode: 'challenge', challengeId: challenge.id, line: challenge.line, work: challenge.work },
    });
  };
  /** 고르는 중에는 카드를 누르면 바로 그 대사에 올린다. 아니면 대사 상세로 간다. */
  const tapCard = (challenge: ChallengeCard) => (picking && canPerform(challenge) ? perform(challenge) : openDetail(challenge));

  const emptyText =
    tab === 'ended' ? t('challenges.emptyEnded') : tab === 'mine' ? t('challenges.emptyMine') : t('challenges.emptyRunning');

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        {/* 첫 사용자는 탭바가 숨으므로 홈(뭐부터 해 볼까요?)으로 돌아갈 꺾쇠를 단다 — 탭바가 보이면 두지 않는다. */}
        {firstTime && (
          <NavIconButton icon="chevron-left" label={t('common.back')} phLabel="challenges_back_home" onPress={() => router.navigate('/')} />
        )}
        <Text style={[styles.title, styles.titleGrow]}>{picking ? t('challengeUpload.pickChallenge') : t('challenges.title')}</Text>
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
      </View>

      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: tabBarSpace + 20 }]}>
        {lastWeek && !picking && (
          <Pressable
            style={({ pressed }) => [styles.banner, pressed && styles.pressed]}
            onPress={() => {
              void logEvent('challenge_last_week_open', { id: lastWeek.id });
              router.push({ pathname: '/challenge-result', params: { id: lastWeek.id, nextId: featured?.id ?? '' } });
            }}
            accessibilityRole="button"
            accessibilityLabel={t('challenges.resultBanner')}>
            <Feather name="award" size={20} color={palette.flameDeep} />
            <View style={styles.flex}>
              <Text style={styles.bannerTitle}>{t('challenges.resultBanner')}</Text>
              <Text style={styles.bannerSub}>
                {t('challenges.resultBannerSub', { count: Math.min(3, lastWeek.entry_count) })}
              </Text>
            </View>
            <Feather name="chevron-right" size={20} color={palette.checkOff} />
          </Pressable>
        )}

        {featured && (
          <TodayHero
            challenge={featured}
            guide={showGuide && !picking}
            onOpen={() => tapCard(featured)}
            onPerform={() => perform(featured)}
          />
        )}

        <View style={styles.tabRow}>
          {TABS.map(({ key, label }) => (
            <Pressable
              key={key}
              style={styles.tab}
              onPress={() => {
                setTab(key);
                setChallenges(null);
                logEvent('challenge_tab', { tab: key });
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: tab === key }}>
              <Text style={[styles.tabText, tab === key && styles.tabTextOn]}>{t(label)}</Text>
            </Pressable>
          ))}
        </View>

        {error && <Text style={styles.error}>{error}</Text>}
        {challenges === null && !error && <ActivityIndicator color={palette.blue} style={{ marginTop: 40 }} />}

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
            {loadingMore ? <ActivityIndicator color={palette.blue} /> : <Text style={styles.moreText}>{t('challenges.moreLines')}</Text>}
          </Pressable>
        )}

        {challenges !== null && challenges.length === 0 && !featured && !error && (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>{emptyText}</Text>
          </View>
        )}

        {tab !== 'mine' && (
          <Pressable style={styles.registerBtn} onPress={() => router.push('/line-new')} accessibilityRole="button">
            <Feather name="plus" size={15} color={palette.blue} />
            <Text style={styles.registerText}>{t('challenges.registerCta')}</Text>
          </Pressable>
        )}
      </ScrollView>

      <ChallengeIntro
        visible={intro}
        onDone={(seeWeek) => {
          setIntro(false);
          void markChallengeIntroSeen();
          if (seeWeek && featured && !picking) openDetail(featured);
        }}
        canSeeWeek={Boolean(featured) && !picking}
      />
    </SafeAreaView>
  );
}

/**
 * 이번 주 대사 카드(SOMA-494·SOMA-748) — 탭을 열면 제일 먼저 크게 보인다. 카드를 누르면 대사 상세(이번 주 대사)로 간다.
 * 인기·최신 탭에서만 띄운다(종료·내 챌린지 탭에는 고정하지 않는다, 요구사항 04).
 */
function TodayHero({
  challenge,
  guide,
  onOpen,
  onPerform,
}: {
  challenge: ChallengeCard;
  guide: boolean;
  onOpen: () => void;
  onPerform: () => void;
}) {
  const meta = [challenge.work, challenge.character].filter(Boolean).join(' · ');
  return (
    <Pressable style={({ pressed }) => [styles.hero, pressed && styles.pressed]} onPress={onOpen} accessibilityRole="button">
      <View style={styles.heroChip}>
        <Feather name="zap" size={15} color={palette.onAccent} />
        <Text style={styles.heroChipText}>
          {challenge.origin === 'team' ? t('challenges.weekLabel') : t('challenges.featuredLabel')} · {dDayLabel(challenge)}
        </Text>
      </View>
      <Text style={styles.heroLine} numberOfLines={4}>
        “{challenge.line}”
      </Text>
      {!!meta && <Text style={styles.heroMeta}>{meta}</Text>}
      <View style={styles.statRow}>
        <View style={styles.avatars}>
          {challenge.participants.slice(0, 3).map((p, i) => (
            <View key={`${p.name}-${i}`} style={[styles.avatar, styles.heroAvatar]}>
              <Text style={styles.avatarText}>{avatarLetter(p.name)}</Text>
            </View>
          ))}
        </View>
        <Text style={styles.heroStat} numberOfLines={1}>
          {t('challenges.entryCount', { count: challenge.entry_count })} ·{' '}
          {t('challenges.likeSum', { count: challenge.like_sum })}
        </Text>
      </View>
      {/* 바로 아래 「나도 이 대사 연기하기」가 있으면 그 버튼을 가리킨다 — 카드를 누르라는 말과 따로 놀지 않게(10/22 피드백). */}
      {guide && <Text style={styles.guide}>{t(canPerform(challenge) ? 'challenges.heroGuidePerform' : 'challenges.heroGuide')}</Text>}
      {canPerform(challenge) && (
        <Pressable style={styles.heroPerform} onPress={onPerform} accessibilityRole="button">
          <Feather name="video" size={15} color={palette.onAccent} />
          <Text style={styles.heroPerformText}>{t('challenges.performCta')}</Text>
        </Pressable>
      )}
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
        <View style={styles.rowIcon}>
          <Feather name="message-square" size={20} color={palette.blue} />
        </View>
        <View style={styles.rowBody}>
          <Text style={styles.line} numberOfLines={3}>
            “{challenge.line}”
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {host} · {t('challenges.entryCount', { count: challenge.entry_count })} · {dDayLabel(challenge)}
          </Text>
          <View style={styles.statRow}>
            <View style={styles.avatars}>
              {challenge.participants.slice(0, 3).map((p, i) => (
                <View key={`${p.name}-${i}`} style={styles.avatar}>
                  <Text style={styles.avatarText}>{avatarLetter(p.name)}</Text>
                </View>
              ))}
            </View>
            <Text style={styles.stat} numberOfLines={1}>
              {participantsLabel(challenge.participants, challenge.more_count)} ·{' '}
              {t('challenges.likeSum', { count: challenge.like_sum })}
            </Text>
          </View>
        </View>
        <Feather name="chevron-right" size={20} color={palette.textFaint} />
      </Pressable>
      {canPerform(challenge) && (
        <Pressable style={styles.performBtn} onPress={onPerform} accessibilityRole="button">
          <Feather name="video" size={14} color={palette.blue} />
          <Text style={styles.performText}>{t('challenges.performCta')}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.85 },
  moreBtn: { alignItems: 'center', paddingVertical: 14 },
  moreText: { color: palette.blue, fontSize: 14, fontWeight: '600' },
  safe: { flex: 1, backgroundColor: palette.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingTop: 10,
    paddingBottom: 6,
  },
  title: { fontSize: 24, fontWeight: '900', color: palette.text, lineHeight: 34 },
  titleGrow: { flex: 1 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  iconBtn: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  badgeDot: {
    position: 'absolute',
    top: 1,
    right: 1,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: palette.danger,
  },
  body: { paddingHorizontal: 24, paddingTop: 6, gap: 12 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    borderRadius: 16,
    backgroundColor: palette.flameSoft,
  },
  bannerTitle: { fontSize: 15, fontWeight: '800', color: palette.text, lineHeight: 22 },
  bannerSub: { fontSize: 12, fontWeight: '600', color: palette.textMuted, lineHeight: 18, marginTop: 6 },
  hero: { backgroundColor: palette.navy, borderRadius: 20, padding: 18, gap: 10 },
  heroChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  heroChipText: { fontSize: 13, fontWeight: '800', color: palette.onAccent, lineHeight: 20 },
  heroLine: { fontSize: 18, fontWeight: '800', color: palette.onAccent, lineHeight: 27 },
  heroMeta: { fontSize: 13, fontWeight: '600', color: 'rgba(255, 255, 255, 0.67)', lineHeight: 20 },
  heroStat: { flex: 1, fontSize: 12.5, fontWeight: '700', color: 'rgba(255, 255, 255, 0.67)' },
  heroAvatar: { borderColor: palette.navy },
  guide: { fontSize: 14, fontWeight: '700', color: palette.blueDeep, lineHeight: 21 },
  heroPerform: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 14,
    paddingVertical: 13,
    marginTop: 2,
    backgroundColor: palette.blue,
  },
  heroPerformText: { fontSize: 14.5, fontWeight: '800', color: palette.onAccent },
  tabRow: { flexDirection: 'row', gap: 16, paddingTop: 4 },
  tab: { paddingVertical: 4 },
  tabText: { fontSize: 15, fontWeight: '700', color: palette.textFaint, lineHeight: 23 },
  tabTextOn: { fontWeight: '800', color: palette.text },
  error: { color: palette.danger, fontSize: 13.5, fontWeight: '700', textAlign: 'center', paddingVertical: 12 },
  row: { borderRadius: 16, gap: 4 },
  rowMain: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 15, paddingHorizontal: 4, borderRadius: 16 },
  rowIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  rowBody: { flex: 1, minWidth: 0, gap: 6 },
  line: { fontSize: 16, fontWeight: '800', color: palette.text, lineHeight: 24 },
  meta: { fontSize: 13, fontWeight: '600', color: palette.textFaint, lineHeight: 20 },
  statRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  avatars: { flexDirection: 'row' },
  avatar: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: palette.blueSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: -6,
    borderWidth: 1,
    borderColor: palette.bg,
  },
  avatarText: { fontSize: 10.5, fontWeight: '900', color: palette.blueDeep },
  stat: { flex: 1, fontSize: 12.5, fontWeight: '600', color: palette.textFaint },
  performBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    marginLeft: 56,
    marginBottom: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: palette.blueSoft,
  },
  performText: { fontSize: 13, fontWeight: '800', color: palette.blue },
  empty: { paddingVertical: 48, alignItems: 'center' },
  emptyText: { fontSize: 14.5, color: palette.textDim, textAlign: 'center', lineHeight: 23 },
  registerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: palette.blueSoft,
    borderRadius: 12,
    paddingVertical: 14,
    marginTop: 10,
  },
  registerText: { fontSize: 14, fontWeight: '800', color: palette.blue },
});
