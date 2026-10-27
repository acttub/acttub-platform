import Feather from '@expo/vector-icons/Feather';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AdSlot } from '@/components/ad-slot';
import { Button, TextButton } from '@/components/ui/buttons';
import { DefaultAvatar } from '@/components/ui/default-avatar';
import { InlineEmpty } from '@/components/ui/inline-empty';
import { SkeletonCards } from '@/components/ui/skeleton';
import { NavHeader, NavIconButton } from '@/components/ui/nav-header';
import { useTabBarSpace } from '@/components/ui/tab-bar';
import { FoundingBadge } from '@/components/founding-badge';
import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';
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
      return () => {
        alive = false;
      };
    }, []),
  );

  // 정본은 서버의 프로필 이름이다. 아직 못 읽었으면 기기에 적어 둔 이름으로 부른다.
  const display = displayNameFor(serverProfile?.name ?? name, user?.email ?? null) || t('profileTab.title');
  // 「배우 활동 · 연기 1년 미만」 — 가입 때 받은 최종 목표와 연기 경력.
  const goalIndex = serverProfile?.goal ? GOAL_VALUES.indexOf(serverProfile.goal) : -1;
  const careerIndex = serverProfile?.experience ? EXPERIENCE_VALUES.indexOf(serverProfile.experience) : -1;
  const chips = [translateList('profileName.goalOptions')[goalIndex], translateList('profileName.careerOptions')[careerIndex]].filter(
    (label): label is string => !!label,
  );

  const practiceCards = groups ? profileTabCards(groups).slice(0, CARD_LIMIT) : null;
  // 연습 카드 제목은 「다음에 해 볼 것」(노트의 다음 테이크 문장), 없으면 장면 제목이다. 코치 관찰(노트 제목)은 쓰지 않는다.
  const nextTakes = useNextTakes((practiceCards ?? []).map(({ group }) => lastNotePracticeId(group)));
  const entryCards = entries ? entries.slice(0, CARD_LIMIT) : null;
  const savedCards = saved ? saved.slice(0, CARD_LIMIT) : null;
  const shortDate = (iso: string | null | undefined) => formatKoreanDate(iso, { month: 'long', day: 'numeric' });

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* 첫 사용자는 탭바가 숨으므로 홈으로 돌아갈 꺾쇠를 단다(탭바 없이는 딥링크로만 온다) — 탭바가 보이면 두지 않는다. */}
      <NavHeader
        large
        title={t('profileTab.title')}
        left={
          firstTime ? (
            <NavIconButton icon="chevron-left" size={26} label={t('common.back')} phLabel="profile_back_home" onPress={() => router.navigate('/')} />
          ) : null
        }
        right={<NavIconButton icon="settings" label={t('settings.title')} phLabel="profile_settings" onPress={() => router.push('/settings')} />}
      />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: tabBarSpace + space[5] }]}>

        <View style={styles.me}>
          <View style={styles.photo}>
            {/* 사진이 없으면 pen 기본 얼굴(P/DefaultAvatar). */}
            {photoUri ? (
              <Image source={{ uri: photoUri }} style={styles.photoImg} contentFit="cover" />
            ) : (
              <DefaultAvatar size={84} seed={user?.id} />
            )}
          </View>
          <View style={styles.meText}>
            <Text style={styles.name} numberOfLines={1}>
              {display}
            </Text>
            <FoundingBadge number={profile.me?.founding_number} />
            <Text style={[styles.bio, !bio && styles.bioEmpty]} numberOfLines={2}>
              {bio || t('profileTab.introEmpty')}
            </Text>
            {chips.length > 0 && (
              <View style={styles.chips}>
                {chips.map((label) => (
                  <View key={label} style={styles.chip}>
                    <Text style={styles.chipText}>{label}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
          <Button size="sm" variant="secondary" label={t('profileTab.edit')} phLabel="profile_edit" onPress={() => router.push('/profile-edit')} />
        </View>

        <AdSlot slot="profile_top" />

        {/* 「코치가 기억하는 것」 바로가기는 뺐다(10/25 결정) — 기억은 코치가 계속 쓰지만 배우에게 화면으로 보여 주지 않는다. */}
        <View style={styles.month}>
          <MonthCell label={t('profileTab.monthLabel')} count={counts.total} />
          <MonthCell dot={palette.blue} label={t('profileTab.kindCoaching')} count={counts.coaching} />
          <MonthCell dot={palette.green} label={t('profileTab.kindReading')} count={counts.reading} />
          <MonthCell dot={palette.flame} label={t('profileTab.kindChallenge')} count={counts.challenge} />
        </View>

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
            empty={[t('profileTab.emptyPracticeTitle'), t(firstTime ? 'profileTab.emptyPracticeBodyFirst' : 'profileTab.emptyPracticeBody')]}
            more={groups && groups.length > CARD_LIMIT ? () => router.push('/history') : undefined}
            cards={(practiceCards ?? []).map(({ group, at }) => ({
              key: group.root_id,
              poster: groupPoster(group),
              title: nextTakes[lastNotePracticeId(group) ?? ''] || sceneTitle(group),
              meta: shortDate(at),
              onPress: () => router.push(groupRowTarget(group)),
            }))}
          />
        )}
        {tab === 'entries' && (
          <CardGrid
            loading={entryCards === null}
            empty={[t('profileTab.emptyEntriesTitle'), t('profileTab.emptyEntriesBody')]}
            // P03 내 참여작 — 공개 범위 바꾸기·지우기는 원래 화면에서 한다(challenge.browse).
            more={() => router.push('/challenge-entries')}
            below
            cards={(entryCards ?? []).map((entry) => ({
              key: entry.id,
              poster: entry.poster_url ? { uri: entry.poster_url, cacheKey: entry.poster_url.split('?')[0] } : null,
              // pen S14.4 — 「“대사”」 아래 작품, 하트 수 · 나만 보기.
              title: [`“${entry.challenge.line}”`, (entry.challenge.work ?? '').trim()].filter(Boolean).join('\n'),
              likes: entry.like_count,
              meta: entry.visibility === 'public' ? '' : t('profileTab.visibilityPrivate'),
              locked: entry.visibility !== 'public',
              // 참여작을 누르면 내 참여작 목록으로 간다(AI 리포트 화면은 SOMA-820에서 없앴다).
              onPress: () => router.push('/challenge-entries'),
            }))}
          />
        )}
        {tab === 'saved' && (
          <CardGrid
            loading={savedCards === null}
            empty={[t('savedVideos.emptyTitle'), t('savedVideos.emptyBody')]}
            more={saved && saved.length > CARD_LIMIT ? () => router.push('/saved-videos') : undefined}
            below
            cards={(savedCards ?? []).map((entry) => ({
              key: entry.id,
              poster: null,
              // pen S14.5 — 캡션(없으면 작성자), 하트 수 · 작성자.
              title: entry.caption?.trim() || entry.author.name,
              likes: entry.like_count,
              meta: entry.author.name,
              onPress: () => router.push({ pathname: '/challenge-play', params: { entryId: entry.id } }),
            }))}
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function MonthCell({ dot, label, count }: { dot?: string; label: string; count: number }) {
  return (
    <View style={styles.monthCell}>
      <Text style={styles.monthCount}>{count}</Text>
      <View style={styles.monthHead}>
        {!!dot && <View style={[styles.monthDot, { backgroundColor: dot }]} />}
        <Text style={styles.monthLabel} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>
          {label}
        </Text>
      </View>
    </View>
  );
}

type Card = {
  key: string;
  poster: { uri: string; cacheKey: string } | null;
  title: string;
  /** 연습 기록은 날짜, 참여작은 「나만 보기」, 저장됨은 작성자. 빈 글이면 하트 수만 둔다. */
  meta: string;
  /** 있으면 하트와 함께 보인다(참여작·저장됨). */
  likes?: number;
  /** 나만 보기 참여작 — 썸네일 오른쪽 위 자물쇠. */
  locked?: boolean;
  onPress: () => void;
};

/** pen 그리드는 한 줄에 세 칸(114, 사이 4)이고, 모자란 칸은 빈 회색 칸으로 채운다. */
const PER_ROW = 3;

function CardGrid({
  loading,
  empty,
  cards,
  more,
  below = false,
}: {
  loading: boolean;
  /** 빈 상태 InlineEmpty 의 제목·설명. */
  empty: [string, string];
  cards: Card[];
  more?: () => void;
  /** 참여작·저장됨(pen S14.4·S14.5) — 썸네일 152 아래에 제목·하트 줄. 아니면 연습 기록처럼 썸네일 위에 글을 얹는다. */
  below?: boolean;
}) {
  if (loading) return <SkeletonCards count={3} columns={3} aspectRatio={0.8} style={styles.skeleton} />;
  if (cards.length === 0) return <InlineEmpty title={empty[0]} description={empty[1]} />;
  const rows: (Card | null)[][] = [];
  for (let i = 0; i < cards.length; i += PER_ROW) {
    const row: (Card | null)[] = cards.slice(i, i + PER_ROW);
    while (row.length < PER_ROW) row.push(null);
    rows.push(row);
  }
  const thumb = (card: Card) =>
    card.poster ? (
      <Image source={{ uri: card.poster.uri, cacheKey: card.poster.cacheKey }} style={StyleSheet.absoluteFill} contentFit="cover" />
    ) : (
      <View style={styles.thumbEmpty}>
        <Feather name="play" size={22} color={palette.textDisabled} />
      </View>
    );
  return (
    <View style={styles.gridWrap}>
      <View style={styles.grid}>
        {rows.map((row, r) => (
          <View key={r} style={styles.gridRow}>
            {row.map((card, c) =>
              !card ? (
                <View key={`empty-${c}`} style={[styles.cellEmpty, below ? styles.cellEmptyBelow : styles.card]} />
              ) : below ? (
                <Pressable key={card.key} style={styles.cardBelow} onPress={card.onPress} accessibilityRole="button" accessibilityLabel={card.title}>
                  <View style={styles.thumbBelow}>
                    {thumb(card)}
                    {card.locked && (
                      <View style={styles.lock}>
                        <Feather name="lock" size={11} color={palette.onAccent} />
                      </View>
                    )}
                  </View>
                  <View style={styles.infoBelow}>
                    <Text style={styles.titleBelow} numberOfLines={2}>
                      {card.title}
                    </Text>
                    <View style={styles.metaRow}>
                      <Ionicons name="heart-outline" size={12} color={palette.danger} />
                      <Text style={styles.likes}>{card.likes ?? 0}</Text>
                      {!!card.meta && (
                        <Text style={styles.metaBelow} numberOfLines={1}>
                          · {card.meta}
                        </Text>
                      )}
                    </View>
                  </View>
                </Pressable>
              ) : (
                <Pressable key={card.key} style={styles.card} onPress={card.onPress} accessibilityRole="button" accessibilityLabel={card.title}>
                  {thumb(card)}
                  {/* pen은 아래로 짙어지는 그라데이션 — 그라데이션 모듈이 없어 아래쪽에 옅은 막을 깐다. */}
                  <View style={styles.scrim} pointerEvents="none" />
                  <Text style={styles.cardTitle} numberOfLines={2}>
                    {card.title}
                  </Text>
                  <View style={styles.metaRow}>
                    <Feather name="play" size={10} color={palette.onMediaSub} />
                    <Text style={styles.cardMeta} numberOfLines={1}>
                      {card.meta}
                    </Text>
                  </View>
                </Pressable>
              ),
            )}
          </View>
        ))}
      </View>
      {more && (
        <TextButton tone="accent" label={t('profileTab.seeAll')} onPress={more} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  content: { paddingHorizontal: space.gutter, paddingTop: space[2], gap: space[4] },

  me: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[4],
    padding: space[4],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.bg,
  },
  photo: {
    width: 84,
    height: 84,
    borderRadius: radius.full,
    backgroundColor: palette.bgSoft,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  photoImg: { width: '100%', height: '100%' },
  meText: { flex: 1, minWidth: 0, gap: space[1.5] },
  name: { ...type.title2, color: palette.text },
  bio: { ...type.body2, color: palette.textSub },
  bioEmpty: { color: palette.textMeta },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[1.5] },
  chip: { paddingVertical: space[1], paddingHorizontal: space[2], borderRadius: radius.full, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.bg },
  chipText: { ...type.micro, color: palette.textSub },

  month: { flexDirection: 'row' },
  monthCell: { flex: 1, alignItems: 'center', gap: space[1] },
  monthHead: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  monthDot: { width: 6, height: 6, borderRadius: radius.full },
  monthLabel: { ...type.caption, color: palette.textSub },
  monthCount: { ...type.headline, color: palette.text },

  tabs: { flexDirection: 'row', gap: space[1], padding: space[1], borderRadius: radius.md, backgroundColor: palette.bgSoft },
  tab: { flex: 1, height: 36, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  tabOn: { backgroundColor: palette.bg },
  tabText: { ...type.body2Bold, color: palette.textMeta },
  tabTextOn: { color: palette.text },

  skeleton: { paddingHorizontal: 0 },
  gridWrap: { gap: space[3] },
  grid: { gap: space[1] },
  gridRow: { flexDirection: 'row', gap: space[1] },
  card: {
    flex: 1,
    height: 154,
    borderRadius: radius.sm,
    overflow: 'hidden',
    backgroundColor: palette.bgSoft,
    justifyContent: 'flex-end',
    paddingHorizontal: space[2],
    paddingBottom: space[2],
    gap: space[1],
  },
  thumbEmpty: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  scrim: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '55%', backgroundColor: palette.scrim },
  cardTitle: { ...type.micro, color: palette.onAccent },
  cardMeta: { ...type.micro, color: palette.onMediaSub },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  cellEmpty: { flex: 1, borderRadius: radius.sm, backgroundColor: palette.bgSoft },
  cellEmptyBelow: { height: 152 },
  cardBelow: { flex: 1, gap: space[1.5] },
  thumbBelow: { height: 152, borderRadius: radius.sm, overflow: 'hidden', backgroundColor: palette.bgSoft },
  lock: { position: 'absolute', top: space[1.5], right: space[1.5], width: 22, height: 22, borderRadius: radius.full, backgroundColor: palette.scrim, alignItems: 'center', justifyContent: 'center' },
  infoBelow: { gap: space[1] },
  titleBelow: { ...type.captionBold, color: palette.text },
  likes: { ...type.micro, color: palette.textMeta },
  metaBelow: { flexShrink: 1, ...type.micro, color: palette.textMeta },
  more: { alignSelf: 'center' },
  moreText: { ...type.body2Bold, color: palette.blueDeep },
});
