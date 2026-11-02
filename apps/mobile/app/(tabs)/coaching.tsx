import Feather from '@expo/vector-icons/Feather';
import { useFocusEffect, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { useCallback, useMemo, useState, type ComponentProps } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SkeletonDetail } from '@/components/ui/skeleton';
import { PrimaryButton } from '@/components/ui/buttons';
import { NavHeader, NavIconButton } from '@/components/ui/nav-header';
import { MASCOT } from '@/components/ui/mascot';
import { useTabBarSpace } from '@/components/ui/tab-bar';
import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';
import { useFirstTimeUser } from '@/hooks/use-first-time-user';
import { useNextTakes } from '@/hooks/use-next-takes';
import { api } from '@/lib/api';
import { dateLocale, translate as t } from '@/lib/i18n';
import { coachingEntry, type CoachingEntry } from '@/lib/practice/coaching-entry';
import { groupPoster, groupRowTarget, recentGroups, sceneTitle } from '@/lib/practice/groups';
import { continueActionFor } from '@/lib/practice/resume';
import { setContinueOrigin } from '@/lib/practice/session-state';
import type { PracticeGroup } from '@/lib/practice/types';

/** 「최근 코칭」에 보이는 묶음 수(pen P13.3). */
const RECENT_COUNT = 2;

function shortDate(iso: string | null | undefined): string {
  const d = new Date(iso ?? '');
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(dateLocale(), { month: 'long', day: 'numeric' });
}

/**
 * 코칭 탭(pen 「코칭 탭 · 처음」·「다음 연습」·「하던 코칭 이어서」). 가운데 촬영 버튼을 대신해 코칭을 시작하는 곳이다.
 *
 * - 처음: 소개 말풍선 · 예시 대화, 아래 링크 줄(영상 없이 말로 | 대사부터 같이 만들기)과 「영상 보여 주고 코칭 받기」 버튼 하나.
 *   버튼은 목적을 묻지 않는 첫 코칭 새 연습(app/upload?first=1)으로 간다(SOMA-984).
 * - 다음 연습(pen P13.3·P13.5): 저번 코치 메모 카드 · 새 영상/지난 코칭 타일 · 「다른 방법으로 코칭 받기」 한 줄 · 최근 코칭.
 *   말로 코칭 · 내 대본으로 찍기 · 대사부터 같이 만들기는 그 한 줄이 여는 선택 화면(app/coach-other)에 모았다(SOMA-984 B안).
 * - 하던 코칭(pen P13.4): 메모 카드 자리가 「하던 코칭 · 이어서 하기」로 바뀌고 나머지는 같다.
 *
 * 디자인의 「2개 남음」 같은 남은 횟수는 서버에 그 값이 없어 그리지 않고, 장면 제목만 보조 글로 둔다.
 */
export default function CoachingTab() {
  const tabBarSpace = useTabBarSpace();
  const router = useRouter();
  const firstTime = useFirstTimeUser();
  const [entry, setEntry] = useState<CoachingEntry | null>(null);
  const [groups, setGroups] = useState<PracticeGroup[]>([]);
  const takes = useNextTakes([entry?.kind === 'next' ? entry.notePracticeId : null]);
  const nextTake = entry?.kind === 'next' ? (takes[entry.notePracticeId] ?? null) : null;
  const visible = useMemo(() => recentGroups(groups, groups.length), [groups]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      api
        .listPracticeGroups('all')
        .then(({ groups: list }) => {
          if (cancelled) return;
          setGroups(list);
          setEntry(coachingEntry(list));
        })
        .catch(() => {
          if (!cancelled) setEntry({ kind: 'first' });
        });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  const first = entry?.kind === 'first';
  // 새 연습은 세션 목적 → 영상 고르기 순서다(app/upload).
  const startNew = () => router.push('/upload');
  // 첫 코칭은 목적을 묻지 않고 영상 고르기부터 한다(SOMA-984).
  const startFirst = () => router.push({ pathname: '/upload', params: { first: '1' } });
  // 「이전 코칭 이어 하기」는 지난 코칭 목록에서 고른다.
  // 「하던 코칭 · 이어서 하기」는 열린 대화로, 「저번 코치 메모 · 한 번 더 연습」은 열린 대화가 있으면 그 대화, 없으면 다음 테이크(새 영상)로 간다.
  const again = () => {
    if (entry?.kind === 'resume') {
      const open = entry.group.in_progress_practice_id;
      if (open) router.push({ pathname: '/coach', params: { practiceId: open } });
      return;
    }
    if (entry?.kind !== 'next') return;
    const action = continueActionFor(entry.group);
    if (action.kind === 'resume') {
      router.push({ pathname: '/coach', params: { practiceId: action.practiceId } });
      return;
    }
    const last = entry.group.practices[entry.group.practices.length - 1];
    setContinueOrigin({ kind: 'group', rootId: entry.group.root_id, practiceId: last?.id ?? entry.group.root_id });
    router.push('/upload');
  };
  const resuming = entry?.kind === 'resume';
  const noteAt =
    entry?.kind === 'next'
      ? (entry.group.practices.find((p) => p.id === entry.notePracticeId)?.created_at ?? entry.group.last_practiced_at)
      : null;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* 첫 사용자 홈에서 이 길을 고른 뒤에도 홈(뭐부터 해 볼까요?)으로 돌아가 다른 길을 고를 수 있다(SOMA-771). */}
      {/* 탭 첫 화면 머리(NavHeader/Large) — 큰 왼쪽 제목 「코칭」과 오른쪽 설정. */}
      <NavHeader
        large
        title={t('coachingTab.title')}
        // 탭바가 보이면 하단 탭으로 홈에 갈 수 있어 뒤로를 두지 않는다 — 탭바를 숨긴 첫 사용자만(10/22 피드백).
        left={firstTime ? <NavIconButton icon="chevron-left" size={24} label={t('common.back')} phLabel="coaching_back_home" onPress={() => router.navigate('/')} /> : undefined}
        right={
          // 첫 사용자는 탭바가 숨어 프로필 탭의 설정으로 못 간다 — 로그아웃·탈퇴 길을 남긴다(SOMA-781). 그 밖에는 프로필 탭에 설정이 있다.
          firstTime && first ? (
            <NavIconButton icon="settings" size={22} label={t('settings.title')} phLabel="coaching_first_settings" onPress={() => router.push('/settings')} />
          ) : undefined
        }
      />
      {!entry ? (
        <SkeletonDetail media lines={5} />
      ) : entry.kind === 'first' ? (
        <View style={styles.flex}>
          <ScrollView contentContainerStyle={styles.firstBody}>
            <View style={styles.introRow}>
              <Image source={MASCOT.slate} style={styles.introMascot} contentFit="contain" cachePolicy="memory-disk" accessibilityIgnoresInvertColors />
              <View style={styles.introBubble}>
                <Text style={styles.introTitle}>{t('coachingTab.firstTitle')}</Text>
                <Text style={styles.introBody}>{t('coachingTab.firstBody')}</Text>
              </View>
            </View>
            <Text style={styles.exampleLabel}>{t('coachingTab.exampleLabel')}</Text>
            <View style={styles.example}>
              <View style={styles.exampleVideo}>
                <View style={styles.exampleThumb}>
                  <Feather name="play" size={14} color={palette.onAccent} />
                </View>
                <View style={styles.exampleVideoText}>
                  <Text style={styles.exampleVideoTitle}>{t('coachingTab.demoVideo')}</Text>
                  <Text style={styles.exampleVideoSub}>{t('coachingTab.demoVideoSub')}</Text>
                </View>
              </View>
              <ExampleCoachLine text={t('coachingTab.exampleQ1')} />
              <View style={styles.exampleMeRow}>
                <View style={styles.exampleMe}>
                  <Text style={styles.exampleMeText}>{t('coachingTab.exampleA')}</Text>
                </View>
              </View>
              <ExampleCoachLine text={t('coachingTab.exampleQ2')} />
            </View>
            <View style={styles.exampleNote}>
              <Feather name="message-circle" size={15} color={palette.blue} />
              <Text style={styles.exampleNoteText}>{t('coachingTab.exampleNote')}</Text>
            </View>
          </ScrollView>
          {/* 찍기·올리기는 같은 화면(app/upload)에서 고르므로 버튼 하나로 두고, 엄지 닿는 아래쪽에 붙인다(SOMA-842). */}
          {/* 아래 바 — 보조 글자 버튼 위, 주 버튼 맨 아래. */}
          <View style={[styles.firstFooter, { paddingBottom: space[2] + tabBarSpace }]}>
            {/* 보조 길 둘은 한 줄 글자 링크(SOMA-984) — 본문에 있던 「대사부터 같이 만들기」 카드를 여기로 내렸다. */}
            <View style={styles.linkRow}>
              <Pressable onPress={() => router.push('/talk')} accessibilityRole="button" accessibilityLabel={t('coachingTab.choice.talk')} ph-label="coaching_first_talk" style={({ pressed }) => [styles.link, pressed && styles.pressed]}>
                <Feather name="message-circle" size={15} color={palette.textSub} />
                <Text style={styles.linkText}>{t('coachingTab.linkTalk')}</Text>
              </Pressable>
              <View style={styles.linkSep} />
              <Pressable onPress={() => router.push('/script-cocreate')} accessibilityRole="button" accessibilityLabel={t('coachingTab.menuScript')} ph-label="coaching_script_cocreate" style={({ pressed }) => [styles.link, pressed && styles.pressed]}>
                <Feather name="edit-3" size={15} color={palette.textSub} />
                <Text style={styles.linkText}>{t('coachingTab.linkScript')}</Text>
              </Pressable>
            </View>
            <PrimaryButton label={t('coachingTab.choice.video')} phLabel="coaching_first_next" onPress={startFirst} />
          </View>
        </View>
      ) : (
        <ScrollView contentContainerStyle={[styles.nextBody, { paddingBottom: tabBarSpace + space[5] }]}>
          {/* 저번 코치 메모(노트의 다음 테이크 문장) 또는 하던 코칭 — 맨 위 카드 */}
          {/* 카드 전체를 누른다 — 카드 안에 따로 버튼을 두지 않는다(UX 가이드 5절, 10/23). */}
          <Pressable
            onPress={again}
            accessibilityRole="button"
            accessibilityLabel={t(resuming ? 'coachingTab.resume' : 'coachingTab.again')}
            ph-label={resuming ? 'coaching_resume' : 'coaching_again'}
            style={({ pressed }) => [styles.memo, pressed && styles.pressed]}>
            <View style={styles.memoHead}>
              <View style={styles.memoAvatar}>
                <Image source={MASCOT.coach} style={styles.memoMascot} contentFit="contain" cachePolicy="memory-disk" accessibilityIgnoresInvertColors />
              </View>
              <View style={styles.flex}>
                <Text style={styles.memoKind}>{t(resuming ? 'coachingTab.resumeKind' : 'coachingTab.memoKind')}</Text>
                <Text style={styles.memoMeta} numberOfLines={1}>
                  {[shortDate(resuming ? entry.group.last_practiced_at : noteAt), sceneTitle(entry.group)].filter(Boolean).join(' · ')}
                </Text>
              </View>
            </View>
            {resuming || nextTake ? (
              <View style={styles.quote}>
                {/* 하던 코칭에는 「다음엔 이렇게 해 봐요」 제목을 붙이지 않는다 — 아래 문장은 조언이 아니라 상태 안내다(10/26). */}
                {!resuming && <Text style={styles.quoteLabel}>{t('coachingTab.memoNext')}</Text>}
                <Text style={styles.quoteText}>{resuming ? t('coachingTab.resumeBody') : nextTake}</Text>
              </View>
            ) : null}
            <View style={styles.memoFooter}>
              <View style={styles.againBtn}>
                <Text style={styles.againText}>{t(resuming ? 'coachingTab.resume' : 'coachingTab.again')}</Text>
                <Feather name="arrow-right" size={15} color={palette.blue} />
              </View>
            </View>
          </Pressable>

          <View style={styles.tiles}>
            <Tile icon="video" title={t('coachingTab.newVideo')} sub={t('coachingTab.newVideoSub')} accent phLabel="coaching_new_video" onPress={startNew} />
            <Tile
              icon="clock"
              title={t('coachingTab.history')}
              sub={t('coachingTab.historyCount', { count: visible.length })}
              phLabel="coaching_history"
              onPress={() => router.push('/history')}
            />
          </View>

          {/* 말로 코칭 · 내 대본 · 대사 같이 만들기는 한 줄로 모아 선택 화면에서 고른다(SOMA-984 B안). */}
          <Pressable
            onPress={() => router.push('/coach-other')}
            accessibilityRole="button"
            accessibilityLabel={t('coachingTab.otherWays')}
            ph-label="coaching_other_ways"
            style={({ pressed }) => [styles.otherWays, pressed && styles.pressed]}>
            <Feather name="message-circle" size={15} color={palette.textSub} />
            <Text style={styles.otherWaysText}>{t('coachingTab.otherWays')}</Text>
            <Feather name="chevron-right" size={15} color={palette.textSub} />
          </Pressable>

          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>{t('coachingTab.recentTitle')}</Text>
            <Pressable onPress={() => router.push('/history')} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('coachingTab.viewAll')} ph-label="coaching_recent_all" style={styles.more}>
              <Text style={styles.moreText}>{t('coachingTab.viewAll')}</Text>
              <Feather name="chevron-right" size={14} color={palette.iconFaint} />
            </Pressable>
          </View>
          <View style={styles.recent}>
            {visible.slice(0, RECENT_COUNT).map((g) => {
              const poster = groupPoster(g);
              return (
                <Pressable key={g.root_id} onPress={() => router.push(groupRowTarget(g))} accessibilityRole="button" style={({ pressed }) => [styles.recentRow, pressed && styles.pressed]}>
                  <View style={styles.thumb}>
                    {poster ? <Image source={{ uri: poster.uri, cacheKey: poster.cacheKey }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} /> : null}
                    <View style={styles.play}>
                      <Feather name="play" size={11} color={palette.onAccent} />
                    </View>
                  </View>
                  <View style={styles.flex}>
                    <Text style={styles.recentTitle} numberOfLines={1}>{sceneTitle(g)}</Text>
                    <Text style={styles.recentMeta}>{shortDate(g.last_practiced_at)}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

/** 처음 화면 예시 대화의 코치 줄(pen P13.1 코치 줄: 아바타 28 + 말풍선). */
function ExampleCoachLine({ text }: { text: string }) {
  return (
    <View style={styles.coachRow}>
      <View style={styles.coachAvatar}>
        <Image source={MASCOT.coach} style={styles.coachMascot} contentFit="contain" cachePolicy="memory-disk" accessibilityIgnoresInvertColors />
      </View>
      <View style={styles.coachBubble}>
        <Text style={styles.coachText}>{text}</Text>
      </View>
    </View>
  );
}

/** 「다음 연습」의 작은 타일 둘 — 아이콘 22 + 오른쪽 위 화살표, 제목 16/700 두 줄, 보조 12.5. */
function Tile({
  icon,
  title,
  sub,
  accent,
  phLabel,
  onPress,
}: {
  icon: ComponentProps<typeof Feather>['name'];
  title: string;
  sub: string;
  accent?: boolean;
  phLabel: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title.replace('\n', ' ')}
      ph-label={phLabel}
      style={({ pressed }) => [styles.tile, accent && styles.tileAccent, pressed && styles.pressed]}>
      <View style={styles.tileTop}>
        <Feather name={icon} size={22} color={accent ? palette.blue : palette.text} />
        <Feather name="arrow-up-right" size={16} color={palette.textDisabled} />
      </View>
      <View style={styles.tileText}>
        <Text style={[styles.tileTitle, accent && styles.tileTitleAccent]}>{title}</Text>
        <Text style={styles.tileSub} numberOfLines={1}>{sub}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  flex: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.85 },

  // 처음 — 액티 말풍선 · 예시 대화(bg-subtle 묶음) · 대사 만들기 줄 · 아래 보조 글자 버튼 위 · 주 버튼 아래.
  firstBody: { paddingTop: space[2], paddingHorizontal: space.gutter, paddingBottom: space[4] },
  introRow: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  introMascot: { width: 52, height: 61 },
  introBubble: { flex: 1, minWidth: 0, gap: space[1], padding: space[4], borderRadius: radius.lg, backgroundColor: palette.bgSoft },
  introTitle: { ...type.body1Bold, color: palette.text },
  introBody: { ...type.caption, color: palette.textSub },
  exampleLabel: { paddingTop: space[6], paddingBottom: space[2], ...type.captionBold, color: palette.textSub },
  example: { gap: space[3], padding: space[4], borderRadius: radius.lg, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.bgSubtle },
  exampleVideo: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: space[2], padding: space[2], paddingRight: space[3], borderRadius: radius.md, backgroundColor: palette.bg },
  exampleThumb: { width: 32, height: 32, borderRadius: radius.sm, backgroundColor: palette.text, alignItems: 'center', justifyContent: 'center' },
  exampleVideoText: { gap: 2 },
  exampleVideoTitle: { ...type.captionBold, color: palette.text },
  exampleVideoSub: { ...type.micro, color: palette.textMeta },
  coachRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space[2] },
  coachAvatar: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  coachMascot: { width: 19, height: 20 },
  coachBubble: { flexShrink: 1, paddingVertical: space[2], paddingHorizontal: space[3], borderRadius: radius.lg, borderBottomLeftRadius: radius.xs, backgroundColor: palette.bg },
  coachText: { ...type.captionBold, color: palette.text },
  exampleMeRow: { flexDirection: 'row', justifyContent: 'flex-end' },
  exampleMe: { paddingVertical: space[2], paddingHorizontal: space[3], borderRadius: radius.lg, borderBottomRightRadius: radius.xs, backgroundColor: palette.blueDeep },
  exampleMeText: { ...type.captionBold, color: palette.onAccent },
  exampleNote: { flexDirection: 'row', alignItems: 'center', gap: space[1.5], paddingTop: space[3] },
  exampleNoteText: { flex: 1, ...type.caption, color: palette.textMeta },
  firstFooter: { gap: space[2], paddingTop: space[2], paddingHorizontal: space.gutter },

  // 다음 연습·하던 코칭 — 저번 코치 메모 카드(흰 카드 + bg-subtle 인용) → 타일 둘 → 보조 줄 → 최근 코칭.
  nextBody: { paddingTop: space[2], paddingHorizontal: space.gutter },
  memo: { gap: space[3], padding: space[4], borderRadius: radius.lg, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.bg },
  memoHead: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  memoAvatar: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  memoMascot: { width: 26, height: 30 },
  memoKind: { ...type.body2Bold, color: palette.text },
  memoMeta: { ...type.caption, color: palette.textMeta },
  quote: { gap: space[1], padding: space[3], borderRadius: radius.md, backgroundColor: palette.bgSubtle },
  quoteLabel: { ...type.micro, color: palette.blueDeep },
  quoteText: { ...type.body1, color: palette.text },
  memoFooter: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center' },
  againBtn: { flexDirection: 'row', alignItems: 'center', gap: space[1.5] },
  againText: { ...type.body2Bold, color: palette.blue },
  tiles: { flexDirection: 'row', gap: space[2], paddingTop: space[3] },
  tile: { flex: 1, gap: space[2], padding: space[3], borderRadius: radius.lg, backgroundColor: palette.bgSoft },
  tileAccent: { backgroundColor: palette.blueSoft },
  tileTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tileText: { gap: space[1] },
  tileTitle: { ...type.body1Bold, color: palette.text },
  tileTitleAccent: { color: palette.blueDeep },
  tileSub: { ...type.micro, color: palette.textMeta },
  linkRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space[3] },
  linkSep: { width: 1, height: 12, backgroundColor: palette.border },
  link: { height: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space[1.5] },
  linkText: { ...type.body2Bold, color: palette.textSub },
  // 예전 「영상 없이 말로 코칭 받기」 보조 버튼(talk-entry-button)과 같은 모양.
  otherWays: { height: 44, marginTop: space[2], flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  otherWaysText: { fontSize: 15, fontWeight: '600', color: palette.textSub },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: space[6] },
  sectionTitle: { ...type.body1Bold, color: palette.text },
  more: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  moreText: { ...type.captionBold, color: palette.textSub },
  recent: { paddingTop: space[3], gap: space[3] },
  recentRow: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  thumb: { width: 44, height: 44, borderRadius: radius.sm, overflow: 'hidden', backgroundColor: palette.bgSoft, alignItems: 'center', justifyContent: 'center' },
  play: { width: 20, height: 20, borderRadius: radius.full, backgroundColor: palette.scrim, alignItems: 'center', justifyContent: 'center' },
  recentTitle: { ...type.body2Bold, color: palette.text },
  recentMeta: { marginTop: 2, ...type.caption, color: palette.textMeta },
});
