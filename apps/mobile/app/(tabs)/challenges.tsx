import Feather from '@expo/vector-icons/Feather';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
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
  const router = useRouter();
  const [tab, setTab] = useState<ChallengeTab>('popular');
  const [featured, setFeatured] = useState<ChallengeCard | null>(null);
  const [challenges, setChallenges] = useState<ChallengeCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [intro, setIntro] = useState(false);

  const load = useCallback(async (next: ChallengeTab) => {
    setError(null);
    try {
      const result = await api.listChallenges({ tab: next });
      setChallenges(result.challenges);
      // 오늘의 챌린지는 인기·최신 탭에만 고정한다.
      setFeatured(pinsFeatured(next) ? result.featured : null);
    } catch (e) {
      setChallenges([]);
      setFeatured(null);
      setError(browseFailureMessage(browseFailure(e)));
    }
  }, []);

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
        <Text style={styles.title}>{t('challenges.title')}</Text>
        <Pressable style={styles.addBtn} onPress={() => router.push('/line-new')} accessibilityRole="button">
          <Feather name="plus" size={20} color={palette.text} />
        </Pressable>
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
          <View style={styles.featuredWrap}>
            <Text style={styles.sectionLabel}>
              {t('challenges.featuredLabel')} · {dDayLabel(featured)}
            </Text>
            <Card challenge={featured} featured onOpen={() => openDetail(featured)} onPerform={() => perform(featured)} />
          </View>
        )}

        {challenges?.map((challenge) => (
          <Card
            key={challenge.id}
            challenge={challenge}
            onOpen={() => openDetail(challenge)}
            onPerform={() => perform(challenge)}
          />
        ))}

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
