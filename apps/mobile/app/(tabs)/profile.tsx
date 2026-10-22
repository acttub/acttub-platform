import Feather from '@expo/vector-icons/Feather';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { NavIconButton } from '@/components/ui/nav-header';
import { useTabBarSpace } from '@/components/ui/tab-bar';
import { palette } from '@/constants/palette';
import { useFirstTimeUser } from '@/hooks/use-first-time-user';
import { useNextTakes } from '@/hooks/use-next-takes';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { EntryCard, MyEntryCard } from '@/lib/challenge/types';
import { displayNameFor } from '@/lib/display-name';
import { formatKoreanDate } from '@/lib/format';
import { translate as t, translateList } from '@/lib/i18n';
import { groupPoster, groupRowTarget, lastNotePracticeId, sceneTitle } from '@/lib/practice/groups';
import type { PracticeGroupDetail } from '@/lib/practice/types';
import { getUserName } from '@/lib/profile';
import { EXPERIENCE_VALUES, GOAL_VALUES } from '@/lib/profile-form';
import { inMonth, monthPracticeCounts, profileTabCards, type MonthPracticeCounts } from '@/lib/profile-month-stats';

type Tab = 'practice' | 'entries' | 'saved';
/** 탭마다 보여 줄 카드 수. 나머지는 「전체 보기」로 원래 화면에서 본다. */
const CARD_LIMIT = 6;
const EMPTY_COUNTS: MonthPracticeCounts = { coaching: 0, reading: 0, challenge: 0, total: 0 };

/**
 * S14 프로필 탭(pen Y0tPDI·luafK·ktdNI, SOMA-748) — 사진·이름·한 줄 정보·편집, 이번 달 연습(코칭·리딩·챌린지),
 * 코치가 기억하는 것, 그리고 탭(연습 기록 · 참여작 · 저장됨) + 영상 카드.
 *
 * 집계 API 가 없어 이번 달 연습은 이미 받는 목록(연습 묶음·리딩 회차·내 참여작)으로 기기에서 센다(lib/profile-month-stats).
 * 챌린지 수는 참여작 수가 아니라 참여한 서로 다른 챌린지 수다(SOMA-738).
 * pen 의 PRO 배지·공유·「내 목표」(이루고 싶은 것)·「내 일정」은 서버 기능이 없어 그리지 않는다.
 * 보관함·포트폴리오는 설정과 프로필 편집으로 옮겼다.
 */
export default function ProfileScreen() {
  const tabBarSpace = useTabBarSpace();
  const router = useRouter();
  const firstTime = useFirstTimeUser();
  const { user, profile } = useAuth();
  const [name, setName] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('practice');
  const [groups, setGroups] = useState<PracticeGroupDetail[] | null>(null);
  const [entries, setEntries] = useState<MyEntryCard[] | null>(null);
  const [saved, setSaved] = useState<EntryCard[] | null>(null);
  const [memoryCount, setMemoryCount] = useState<number | null>(null);
  const [counts, setCounts] = useState<MonthPracticeCounts>(EMPTY_COUNTS);
  const serverProfile = profile.me?.profile ?? null;
  const photoUri = serverProfile?.photo_url ?? null;
  const bio = serverProfile?.bio?.trim() ?? '';

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void getUserName().then((n) => alive && setName(n?.trim() || null));
      void (async () => {
        const now = new Date();
        const [groupList, entryList, readingSessions] = await Promise.all([
          api
            .listPracticeGroups('all')
            .then((r) => r.groups)
            .catch(() => [] as PracticeGroupDetail[]),
          // 내 참여작은 20개씩이다. 끝까지 읽어 이번 달 챌린지 수와 카드를 같이 만든다(비공개 참여 포함, challenge.browse).
          (async () => {
            const all: MyEntryCard[] = [];
            let cursor: string | undefined;
            while (alive) {
              const r = await api.listMyChallengeEntries(undefined, cursor);
              all.push(...r.entries);
              if (!r.next_cursor) break;
              cursor = r.next_cursor;
            }
            return all;
          })().catch(() => [] as MyEntryCard[]),
          // 리딩 회차는 대본별로만 받는다. 이번 달에 연습한 대본만 회차를 읽는다.
          api
            .listReadingScripts()
            .then((r) =>
              Promise.all(
                r.scripts
                  .filter((s) => inMonth(s.last_practiced_at, now))
                  .map((s) => api.listReadingSessions(s.id).then((x) => x.sessions).catch(() => [])),
              ),
            )
            .then((lists) => lists.flat())
            .catch(() => []),
        ]);
        if (!alive) return;
        setGroups(groupList);
        setEntries(entryList);
        setCounts(monthPracticeCounts({ groups: groupList, readingSessions, entries: entryList }, now));
      })();
      void api
        .listSavedEntries()
        .then((r) => alive && setSaved(r.entries))
        .catch(() => alive && setSaved([]));
      void api
        .actorMemory()
        .then((r) => alive && setMemoryCount(r.items.length))
        .catch(() => {});
      return () => {
        alive = false;
      };
    }, []),
  );

  // 정본은 서버의 프로필 이름이다. 아직 못 읽었으면 기기에 적어 둔 이름으로 부른다.
  const display = displayNameFor(serverProfile?.name ?? name, user?.email ?? null) || t('profileTab.title');
  const initial = display.trim().charAt(0) || '?';
  // 「배우 활동 · 연기 1년 미만」 — 가입 때 받은 최종 목표와 연기 경력.
  const goalIndex = serverProfile?.goal ? GOAL_VALUES.indexOf(serverProfile.goal) : -1;
  const careerIndex = serverProfile?.experience ? EXPERIENCE_VALUES.indexOf(serverProfile.experience) : -1;
  const summary = [translateList('profileName.goalOptions')[goalIndex], translateList('profileName.careerOptions')[careerIndex]]
    .filter(Boolean)
    .join(' · ');

  const practiceCards = groups ? profileTabCards(groups).slice(0, CARD_LIMIT) : null;
  // 연습 카드 제목은 「다음에 해 볼 것」(노트의 다음 테이크 문장), 없으면 장면 제목이다. 코치 관찰(노트 제목)은 쓰지 않는다.
  const nextTakes = useNextTakes((practiceCards ?? []).map(({ group }) => lastNotePracticeId(group)));
  const entryCards = entries ? entries.slice(0, CARD_LIMIT) : null;
  const savedCards = saved ? saved.slice(0, CARD_LIMIT) : null;
  const shortDate = (iso: string | null | undefined) => formatKoreanDate(iso, { month: 'long', day: 'numeric' });

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: tabBarSpace + 20 }]}>
        <View style={styles.top}>
          {/* 첫 사용자는 탭바가 숨으므로 홈으로 돌아갈 꺾쇠를 단다(탭바 없이는 딥링크로만 온다) — 탭바가 보이면 두지 않는다. */}
          {firstTime && (
            <NavIconButton icon="chevron-left" label={t('common.back')} phLabel="profile_back_home" onPress={() => router.navigate('/')} />
          )}
          <Text style={[styles.title, styles.titleGrow]}>{t('profileTab.title')}</Text>
          <NavIconButton icon="settings" size={24} label={t('settings.title')} phLabel="profile_settings" onPress={() => router.push('/settings')} />
        </View>

        <View style={styles.me}>
          <View style={styles.photo}>
            {photoUri ? (
              <Image source={{ uri: photoUri }} style={styles.photoImg} contentFit="cover" />
            ) : (
              <Text style={styles.photoText}>{initial}</Text>
            )}
          </View>
          <View style={styles.meText}>
            <Text style={styles.name} numberOfLines={1}>
              {display}
            </Text>
            {!!summary && (
              <Text style={styles.summary} numberOfLines={1}>
                {summary}
              </Text>
            )}
            {!!bio && (
              <Text style={styles.bio} numberOfLines={2}>
                {bio}
              </Text>
            )}
          </View>
          <Pressable style={styles.editBtn} onPress={() => router.push('/profile-edit')} accessibilityRole="button" ph-label="profile_edit">
            <Text style={styles.editText}>{t('profileTab.edit')}</Text>
          </Pressable>
        </View>

        <View style={styles.month}>
          <Text style={styles.monthTitle}>{t('profileTab.monthTitle', { count: counts.total })}</Text>
          <View style={styles.monthRow}>
            <MonthCell dot={palette.blue} label={t('profileTab.kindCoaching')} count={counts.coaching} />
            <MonthCell dot={palette.green} label={t('profileTab.kindReading')} count={counts.reading} />
            <MonthCell dot={palette.flame} label={t('profileTab.kindChallenge')} count={counts.challenge} />
          </View>
        </View>

        <Pressable
          style={({ pressed }) => [styles.line, pressed && styles.pressed]}
          onPress={() => router.push({ pathname: '/memory', params: { from: 'profile' } })}
          accessibilityRole="button">
          <Ionicons name="sparkles-outline" size={20} color={palette.textDim} />
          <Text style={styles.lineTitle}>{t('profileTab.memoryTitle')}</Text>
          <Text style={styles.lineValue}>
            {memoryCount === null ? '' : t('profileTab.memoryCount', { count: memoryCount })}
          </Text>
          <Feather name="chevron-right" size={18} color={palette.checkOff} />
        </Pressable>

        <View style={styles.tabs}>
          {(
            [
              ['practice', t('profileTab.tabPractice')],
              ['entries', t('profileTab.tabEntries')],
              ['saved', t('profileTab.tabSaved')],
            ] as const
          ).map(([key, label]) => (
            <Pressable
              key={key}
              style={[styles.tab, tab === key && styles.tabOn]}
              onPress={() => setTab(key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === key }}>
              <Text style={[styles.tabText, tab === key && styles.tabTextOn]}>{label}</Text>
            </Pressable>
          ))}
        </View>

        {tab === 'practice' && (
          <CardGrid
            loading={practiceCards === null}
            empty={t('profileTab.emptyPractice')}
            more={groups && groups.length > CARD_LIMIT ? () => router.push('/history') : undefined}
            cards={(practiceCards ?? []).map(({ group, at }) => ({
              key: group.root_id,
              poster: groupPoster(group),
              title: nextTakes[lastNotePracticeId(group) ?? ''] || sceneTitle(group),
              meta: [shortDate(at), t('profileTab.kindCoaching')].filter(Boolean).join(' · '),
              onPress: () => router.push(groupRowTarget(group)),
            }))}
          />
        )}
        {tab === 'entries' && (
          <CardGrid
            loading={entryCards === null}
            empty={t('challengeEntries.empty')}
            // P03 내 참여작 — 공개 범위 바꾸기·지우기는 원래 화면에서 한다(challenge.browse).
            more={() => router.push('/challenge-entries')}
            cards={(entryCards ?? []).map((entry) => ({
              key: entry.id,
              poster: null,
              title: t('profileTab.entryTitle', { line: entry.challenge.line }),
              meta: [
                t('profileTab.likes', { count: entry.like_count }),
                t(entry.visibility === 'public' ? 'profileTab.visibilityPublic' : 'profileTab.visibilityPrivate'),
              ].join(' · '),
              // 참여작을 누르면 AI 리포트(pen luafK).
              onPress: () => router.push({ pathname: '/ai-report', params: { entryId: entry.id } }),
            }))}
          />
        )}
        {tab === 'saved' && (
          <CardGrid
            loading={savedCards === null}
            empty={t('savedVideos.empty')}
            more={saved && saved.length > CARD_LIMIT ? () => router.push('/saved-videos') : undefined}
            cards={(savedCards ?? []).map((entry) => ({
              key: entry.id,
              poster: null,
              title: entry.caption?.trim() || entry.author.name,
              meta: [entry.author.name, t('profileTab.likes', { count: entry.like_count })].join(' · '),
              onPress: () => router.push({ pathname: '/challenge-play', params: { entryId: entry.id } }),
            }))}
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function MonthCell({ dot, label, count }: { dot: string; label: string; count: number }) {
  return (
    <View style={styles.monthCell}>
      <View style={styles.monthHead}>
        <View style={[styles.monthDot, { backgroundColor: dot }]} />
        <Text style={styles.monthLabel}>{label}</Text>
      </View>
      <Text style={styles.monthCount}>{t('profileTab.times', { count })}</Text>
    </View>
  );
}

type Card = {
  key: string;
  poster: { uri: string; cacheKey: string } | null;
  title: string;
  meta: string;
  onPress: () => void;
};

function CardGrid({ loading, empty, cards, more }: { loading: boolean; empty: string; cards: Card[]; more?: () => void }) {
  if (loading) return <ActivityIndicator color={palette.blue} style={styles.loading} />;
  if (cards.length === 0) return <Text style={styles.empty}>{empty}</Text>;
  return (
    <View style={styles.gridWrap}>
      <View style={styles.grid}>
        {cards.map((card) => (
          <Pressable key={card.key} style={styles.card} onPress={card.onPress} accessibilityRole="button" accessibilityLabel={card.title}>
            <View style={styles.thumb}>
              {card.poster ? (
                <Image
                  source={{ uri: card.poster.uri, cacheKey: card.poster.cacheKey }}
                  style={styles.thumbImg}
                  contentFit="cover"
                />
              ) : (
                <Feather name="play" size={22} color={palette.checkOff} />
              )}
            </View>
            <Text style={styles.cardTitle} numberOfLines={1}>
              {card.title}
            </Text>
            <Text style={styles.cardMeta} numberOfLines={1}>
              {card.meta}
            </Text>
          </Pressable>
        ))}
      </View>
      {more && (
        <Pressable style={styles.more} onPress={more} accessibilityRole="button">
          <Text style={styles.moreText}>{t('profileTab.seeAll')}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  pressed: { opacity: 0.7 },
  content: { paddingHorizontal: 20, paddingTop: 4 },
  top: { height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, marginRight: -10 },
  title: { fontSize: 22, fontWeight: '800', color: palette.text },
  titleGrow: { flex: 1 },

  me: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  photo: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: palette.blueSoft,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  photoImg: { width: '100%', height: '100%' },
  photoText: { fontSize: 26, fontWeight: '800', color: palette.blue },
  meText: { flex: 1, minWidth: 0, gap: 2 },
  name: { fontSize: 18, fontWeight: '800', color: palette.text },
  summary: { fontSize: 13, fontWeight: '600', color: palette.textMuted },
  bio: { fontSize: 13, fontWeight: '500', lineHeight: 18, color: palette.textDim },
  editBtn: { backgroundColor: palette.bgSoft, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12 },
  editText: { fontSize: 13, fontWeight: '700', color: palette.textDim },

  month: {
    marginTop: 18,
    backgroundColor: palette.blueMist,
    borderWidth: 1,
    borderColor: palette.blueLine,
    borderRadius: 18,
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 10,
  },
  monthTitle: { fontSize: 15, fontWeight: '800', color: palette.text },
  monthRow: { flexDirection: 'row', gap: 8 },
  monthCell: { flex: 1, backgroundColor: palette.card, borderRadius: 12, paddingVertical: 8, paddingHorizontal: 10, gap: 2 },
  monthHead: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  monthDot: { width: 7, height: 7, borderRadius: 4 },
  monthLabel: { fontSize: 12, fontWeight: '700', color: palette.textMuted },
  monthCount: { fontSize: 17, fontWeight: '800', color: palette.text },

  line: { marginTop: 14, height: 44, flexDirection: 'row', alignItems: 'center', gap: 12 },
  lineTitle: { fontSize: 15, fontWeight: '700', color: palette.text },
  lineValue: { flex: 1, textAlign: 'right', fontSize: 13, fontWeight: '600', color: palette.textMuted },

  tabs: { marginTop: 10, flexDirection: 'row', gap: 4, padding: 4, borderRadius: 12, backgroundColor: palette.bgSoft },
  tab: { flex: 1, height: 34, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  tabOn: { backgroundColor: palette.card },
  tabText: { fontSize: 14, fontWeight: '600', color: palette.textMuted },
  tabTextOn: { fontWeight: '800', color: palette.text },

  loading: { marginTop: 32 },
  empty: { marginTop: 28, textAlign: 'center', fontSize: 14, fontWeight: '600', color: palette.textFaint },
  gridWrap: { marginTop: 12, gap: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 10, rowGap: 16 },
  card: { width: '48%', flexGrow: 1, maxWidth: '50%', gap: 6 },
  thumb: {
    height: 120,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: palette.bgSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbImg: { width: '100%', height: '100%' },
  cardTitle: { fontSize: 13, fontWeight: '700', color: palette.text },
  cardMeta: { fontSize: 12, fontWeight: '600', color: palette.textMuted },
  more: { alignSelf: 'center', paddingVertical: 8, paddingHorizontal: 16 },
  moreText: { fontSize: 14, fontWeight: '700', color: palette.blue },
});
