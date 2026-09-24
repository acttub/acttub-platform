import { AccountContent } from '@/components/account-content';
import Feather from '@expo/vector-icons/Feather';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ChallengeIntro } from '@/components/challenge-intro';
import { palette } from '@/constants/palette';
import { logEvent } from '@/lib/analytics';
import { api } from '@/lib/api';
import {
  avatarLetter,
  browseFailure,
  browseFailureMessage,
  dDayLabel,
  hostLabel,
  participantsLabel,
  pinsFeatured,
} from '@/lib/challenge/browse';
import { hasSeenChallengeIntro, markChallengeIntroSeen } from '@/lib/challenge/intro-state';
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
 */
const TABS: { key: ChallengeTab; label: string }[] = [
  { key: 'popular', label: 'challenges.tabPopular' },
  { key: 'latest', label: 'challenges.tabLatest' },
  { key: 'ended', label: 'challenges.tabEnded' },
  { key: 'mine', label: 'challenges.tabMineShort' },
];

export default function ChallengesScreen() {
  return <AccountContent><ChallengesScreenContent /></AccountContent>;
}

function ChallengesScreenContent() {
  const router = useRouter();
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
  const unread = useUnreadNotifications(true);

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

  const openDetail = (challenge: ChallengeCard) => {
    logEvent('challenge_open_detail', { id: challenge.id });
    router.push({ pathname: '/challenge-detail', params: { id: challenge.id } });
  };
  const perform = (challenge: ChallengeCard) => {
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

  const emptyText =
    tab === 'ended' ? t('challenges.emptyEnded') : tab === 'mine' ? t('challenges.emptyMine') : t('challenges.emptyRunning');

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>{picking ? t('challengeUpload.pickChallenge') : t('challenges.title')}</Text>
        <View style={styles.headerRight}>
          {/* 알림함 — 읽지 않은 묶음이 있으면 점이 붙는다(challenge.notification). */}
          <Pressable
            style={styles.addBtn}
            onPress={() => router.push('/notifications')}
            accessibilityRole="button"
            accessibilityLabel={t('notifications.title')}>
            <Feather name="bell" size={18} color={palette.text} />
            {unread.count > 0 && <View style={styles.badgeDot} />}
          </Pressable>
          <Pressable style={styles.addBtn} onPress={() => router.push('/line-new')} accessibilityRole="button">
            <Feather name="plus" size={20} color={palette.text} />
          </Pressable>
        </View>
      </View>

      <Pressable style={styles.search} onPress={() => router.push('/line-search')} accessibilityRole="button">
        <Feather name="search" size={15} color={palette.textFaint} />
        <Text style={styles.searchPh}>{t('challenges.searchPh')}</Text>
      </Pressable>

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
            {tab === key && <View style={styles.tabUnderline} />}
          </Pressable>
        ))}
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {error && <Text style={styles.error}>{error}</Text>}
        {challenges === null && !error && <ActivityIndicator color={palette.blue} style={{ marginTop: 40 }} />}

        {featured && (
          <TodayHero
            challenge={featured}
            onOpen={() => openDetail(featured)}
            onWatch={() =>
              featured.entry_count > 0
                ? router.push({ pathname: '/challenge-play', params: { id: featured.id } })
                : openDetail(featured)
            }
            onPerform={() => perform(featured)}
            picking={picking}
          />
        )}

        {challenges?.map((challenge) => (
          <Card
            key={challenge.id}
            challenge={challenge}
            onOpen={() => openDetail(challenge)}
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
        onDone={() => {
          setIntro(false);
          void markChallengeIntroSeen();
        }}
      />
    </SafeAreaView>
  );
}

/**
 * 오늘의 챌린지 — 탭을 열면 제일 먼저 크게 보인다(SOMA-494). 목업 때처럼 오늘의 대사가 첫 화면의
 * 주인공이 되게 한다. 인기·최신 탭에서만 띄운다(종료·내 챌린지 탭에는 고정하지 않는다, 요구사항 04).
 */
function TodayHero({
  challenge,
  onOpen,
  onWatch,
  onPerform,
  picking,
}: {
  challenge: ChallengeCard;
  onOpen: () => void;
  onWatch: () => void;
  onPerform: () => void;
  picking: boolean;
}) {
  const meta = [challenge.work, challenge.character].filter(Boolean).join(' · ');
  return (
    <View style={styles.hero}>
      <View style={styles.heroChip}>
        <Text style={styles.heroChipText}>
          🔥 {t('challenges.featuredLabel')} · {dDayLabel(challenge)}
        </Text>
      </View>
      <Pressable onPress={onOpen} accessibilityRole="button">
        <Text style={styles.heroLine} numberOfLines={4}>
          “{challenge.line}”
        </Text>
        {!!meta && <Text style={styles.heroMeta}>{meta}</Text>}
      </Pressable>
      <View style={styles.statRow}>
        <View style={styles.avatars}>
          {challenge.participants.slice(0, 3).map((p, i) => (
            <View key={`${p.name}-${i}`} style={styles.avatar}>
              <Text style={styles.avatarText}>{avatarLetter(p.name)}</Text>
            </View>
          ))}
        </View>
        <Text style={styles.heroStat} numberOfLines={1}>
          {t('challenges.entryCount', { count: challenge.entry_count })} ·{' '}
          {t('challenges.likeSum', { count: challenge.like_sum })}
        </Text>
      </View>
      <View style={styles.heroButtons}>
        {!picking && (
          <Pressable style={styles.heroGhost} onPress={onWatch} accessibilityRole="button">
            <Feather name="play" size={15} color="#FFFFFF" />
            <Text style={styles.heroGhostText}>{t('challenges.watchEntries')}</Text>
          </Pressable>
        )}
        <Pressable style={styles.heroPrimary} onPress={onPerform} accessibilityRole="button">
          <Feather name="video" size={15} color={palette.navy} />
          <Text style={styles.heroPrimaryText}>{t('challenges.performCta')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Card({
  challenge,
  featured,
  onOpen,
  onPerform,
}: {
  challenge: ChallengeCard;
  featured?: boolean;
  onOpen: () => void;
  onPerform: () => void;
}) {
  const meta = [challenge.work, challenge.character].filter(Boolean).join(' · ');
  return (
    <View style={[styles.card, featured && styles.cardFeatured]}>
      <Pressable onPress={onOpen} accessibilityRole="button">
        <Text style={[styles.line, featured && styles.lineFeatured]} numberOfLines={3}>
          “{challenge.line}”
        </Text>
        <Text style={[styles.meta, featured && styles.metaFeatured]}>{meta}</Text>
        {!!challenge.scene_note && (
          <Text style={[styles.note, featured && styles.metaFeatured]} numberOfLines={2}>
            {challenge.scene_note}
          </Text>
        )}
        <Text style={[styles.host, featured && styles.metaFeatured]}>{hostLabel(challenge)}</Text>
      </Pressable>

      <View style={styles.statRow}>
        <View style={styles.avatars}>
          {challenge.participants.slice(0, 3).map((p, i) => (
            <View key={`${p.name}-${i}`} style={styles.avatar}>
              <Text style={styles.avatarText}>{avatarLetter(p.name)}</Text>
            </View>
          ))}
        </View>
        <Text style={[styles.stat, featured && styles.metaFeatured]} numberOfLines={1}>
          {participantsLabel(challenge.participants, challenge.more_count)}
        </Text>
      </View>
      <Text style={[styles.stat, featured && styles.metaFeatured]}>
        {t('challenges.entryCount', { count: challenge.entry_count })} ·{' '}
        {t('challenges.likeSum', { count: challenge.like_sum })} · {dDayLabel(challenge)}
      </Text>

      <Pressable style={styles.performBtn} onPress={onPerform} accessibilityRole="button">
        <Feather name="video" size={15} color="#FFFFFF" />
        <Text style={styles.performText}>{t('challenges.performCta')}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  moreBtn: { alignItems: 'center', paddingVertical: 14 },
  moreText: { color: palette.blue, fontSize: 14, fontWeight: '600' },
  safe: { flex: 1, backgroundColor: palette.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
  },
  title: { fontSize: 24, fontWeight: '800', color: palette.text, letterSpacing: -0.5 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  badgeDot: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: palette.danger,
  },
  addBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: palette.bgSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 20,
    backgroundColor: palette.bgSoft,
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 44,
  },
  searchPh: { fontSize: 14, color: palette.textFaint },
  tabRow: { flexDirection: 'row', gap: 18, paddingHorizontal: 20, marginTop: 16 },
  tab: { paddingBottom: 8, alignItems: 'center', gap: 8 },
  tabText: { fontSize: 14, fontWeight: '700', color: palette.textFaint },
  tabTextOn: { color: palette.text },
  tabUnderline: { height: 2, width: '100%', borderRadius: 1, backgroundColor: palette.text },
  body: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 130, gap: 12 },
  error: { color: palette.danger, fontSize: 13.5, fontWeight: '700', textAlign: 'center', paddingVertical: 12 },
  sectionLabel: { fontSize: 13, fontWeight: '800', color: palette.textMuted },
  featuredWrap: { gap: 8 },
  hero: { backgroundColor: palette.navy, borderRadius: 24, padding: 20, gap: 14 },
  heroChip: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  heroChipText: { fontSize: 12.5, fontWeight: '800', color: '#FFFFFF' },
  heroLine: { fontSize: 23, fontWeight: '900', color: '#FFFFFF', lineHeight: 33 },
  heroMeta: { fontSize: 13.5, fontWeight: '600', color: '#9FB0C9', marginTop: 8 },
  heroStat: { flex: 1, fontSize: 12.5, fontWeight: '700', color: '#9FB0C9' },
  heroButtons: { flexDirection: 'row', gap: 10 },
  heroGhost: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 14,
    paddingVertical: 13,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.35)',
  },
  heroGhostText: { fontSize: 14.5, fontWeight: '800', color: '#FFFFFF' },
  heroPrimary: {
    flex: 1.4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 14,
    paddingVertical: 13,
    backgroundColor: '#FFFFFF',
  },
  heroPrimaryText: { fontSize: 14.5, fontWeight: '900', color: palette.navy },

  card: {
    backgroundColor: palette.bg,
    borderWidth: 1,
    borderColor: palette.borderSoft,
    borderRadius: 18,
    padding: 18,
    gap: 10,
  },
  cardFeatured: { backgroundColor: palette.navy, borderColor: palette.navy },
  line: { fontSize: 17, fontWeight: '800', color: palette.text, lineHeight: 26 },
  lineFeatured: { color: '#FFFFFF' },
  meta: { fontSize: 12.5, fontWeight: '600', color: palette.textMuted },
  metaFeatured: { color: '#9FB0C9' },
  note: { fontSize: 12.5, color: palette.textFaint, lineHeight: 19 },
  host: { fontSize: 12, fontWeight: '600', color: palette.textFaint },
  statRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  avatars: { flexDirection: 'row' },
  avatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: palette.blueSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: -6,
    borderWidth: 1,
    borderColor: palette.bg,
  },
  avatarText: { fontSize: 11, fontWeight: '900', color: palette.blueDeep },
  stat: { flex: 1, fontSize: 12, fontWeight: '600', color: palette.textFaint },
  performBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: palette.blue,
    borderRadius: 12,
    paddingVertical: 13,
    marginTop: 2,
  },
  performText: { fontSize: 15, fontWeight: '800', color: '#FFFFFF' },
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
