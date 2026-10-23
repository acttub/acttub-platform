import Feather from '@expo/vector-icons/Feather';
import { useFocusEffect, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { useCallback, useMemo, useState, type ComponentProps } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ChoiceCard } from '@/components/choice-card';
import { ScriptCocreateEntry } from '@/components/script-cocreate-entry';
import { TalkEntryButton } from '@/components/talk-entry-button';
import { PrimaryButton } from '@/components/ui/buttons';
import { NavHeader, NavIconButton } from '@/components/ui/nav-header';
import { MASCOT } from '@/components/ui/mascot';
import { MascotBubble } from '@/components/ui/mascot-bubble';
import { useTabBarSpace } from '@/components/ui/tab-bar';
import { palette } from '@/constants/palette';
import { useFirstTimeUser } from '@/hooks/use-first-time-user';
import { useNextTakes } from '@/hooks/use-next-takes';
import { api } from '@/lib/api';
import { dateLocale, translate as t } from '@/lib/i18n';
import { coachingEntry, type CoachingEntry } from '@/lib/practice/coaching-entry';
import { groupPoster, groupRowTarget, recentGroups, sceneTitle } from '@/lib/practice/groups';
import { continueActionFor } from '@/lib/practice/resume';
import { setContinueOrigin } from '@/lib/practice/session-state';
import type { PracticeGroup } from '@/lib/practice/types';
import { listScripts } from '@/lib/reading/store';

/** 「최근 코칭」에 보이는 묶음 수(pen P13.3). */
const RECENT_COUNT = 2;

function shortDate(iso: string | null | undefined): string {
  const d = new Date(iso ?? '');
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(dateLocale(), { month: 'long', day: 'numeric' });
}

/** 처음 화면의 입구 셋(pen 「코칭 탭 · 처음」). */
const ENTRY_CHOICES = ['video', 'talk', 'script'] as const;
type EntryChoice = (typeof ENTRY_CHOICES)[number];

/**
 * 코칭 탭(pen 「코칭 탭 · 처음」·「다음 연습」·「하던 코칭 이어서」). 가운데 촬영 버튼을 대신해 코칭을 시작하는 곳이다.
 *
 * - 처음: 액티 말풍선 「어떻게 코칭 받을래요?」 + 고르는 카드 셋(영상 보여 주고 / 영상 없이 말로 / 찍을 대사부터 같이 만들기).
 *   기본 선택은 없고, 고른 뒤 아래 「다음」을 눌러야 넘어간다(선택 규칙).
 * - 다음 연습(pen P13.3·P13.5): 저번 코치 메모 카드(+「한 번 더 연습」) · 새 영상/지난 코칭 타일 · 영상 없이 말로 · 내 대본으로 찍기 · 찍을 대사부터 · 최근 코칭.
 * - 하던 코칭(pen P13.4): 메모 카드 자리가 「하던 코칭 · 이어서 하기」로 바뀌고 나머지는 같다. 「이전 코칭 이어 하기」는 지난 코칭 고르기 줄로 남긴다.
 *
 * 디자인의 「2개 남음」 같은 남은 횟수는 서버에 그 값이 없어 그리지 않고, 장면 제목만 보조 글로 둔다.
 * 「찍을 대사부터 같이 만들기」는 리딩 영역의 script-cocreate 로 연결만 한다.
 */
export default function CoachingTab() {
  const tabBarSpace = useTabBarSpace();
  const router = useRouter();
  const firstTime = useFirstTimeUser();
  const [entry, setEntry] = useState<CoachingEntry | null>(null);
  const [choice, setChoice] = useState<EntryChoice | null>(null);
  // 저장한 대본이 하나라도 있으면 「내 대본으로 찍기」를 보인다(리딩·대본 만들기에서 저장한 대본은 같은 목록이다).
  const [hasScripts, setHasScripts] = useState(false);
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
          setChoice(null);
          setGroups(list);
          setEntry(coachingEntry(list));
        })
        .catch(() => {
          if (!cancelled) setEntry({ kind: 'first' });
        });
      listScripts()
        .then((list) => {
          if (!cancelled) setHasScripts(list.scripts.length > 0);
        })
        .catch(() => undefined);
      return () => {
        cancelled = true;
      };
    }, []),
  );

  const first = entry?.kind === 'first';
  // 새 연습은 세션 목적 → 영상 고르기 순서다(app/upload). 첫 코칭이면 단계마다 파란 안내를 켠다.
  const startNew = () => router.push({ pathname: '/upload', params: first ? { first: '1' } : {} });
  // 「이전 코칭 이어 하기」는 지난 코칭 목록에서 고른다.
  const pickPrevious = () => router.push('/history');
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

  // 처음 화면의 「다음」 — 고른 입구로 간다. 「영상 보여 주고」는 새 연습(목적 → 영상) 흐름이다.
  const goChoice = () => {
    if (choice === 'video') startNew();
    else if (choice === 'talk') router.push('/talk');
    else if (choice === 'script') router.push('/script-cocreate');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* 첫 사용자 홈에서 이 길을 고른 뒤에도 홈(뭐부터 해 볼까요?)으로 돌아가 다른 길을 고를 수 있다(SOMA-771). */}
      <NavHeader
        title={t('coachingTab.title')}
        // 탭바가 보이면 하단 탭으로 홈에 갈 수 있어 뒤로를 두지 않는다 — 탭바를 숨긴 첫 사용자만(10/22 피드백).
        left={firstTime ? <NavIconButton icon="chevron-left" size={24} label={t('common.back')} phLabel="coaching_back_home" onPress={() => router.navigate('/')} /> : undefined}
        right={
          // 첫 사용자는 탭바가 숨어 프로필 탭의 설정으로 못 간다 — 로그아웃·탈퇴 길을 남긴다(SOMA-781).
          firstTime && first ? (
            <NavIconButton icon="settings" size={24} label={t('settings.title')} phLabel="coaching_first_settings" onPress={() => router.push('/settings')} />
          ) : undefined
        }
      />
      {!entry ? (
        <View style={styles.center}>
          <ActivityIndicator color={palette.blue} />
        </View>
      ) : entry.kind === 'first' ? (
        <View style={styles.flex}>
          <ScrollView contentContainerStyle={styles.firstBody}>
            <MascotBubble source={MASCOT.slate} title={t('coachingTab.chooseBubble')} guide={t('coachingTab.chooseGuide')} />
            <View style={styles.choices}>
              {ENTRY_CHOICES.map((key) => (
                <ChoiceCard
                  key={key}
                  title={t(`coachingTab.choice.${key}`)}
                  sub={t(`coachingTab.choiceSub.${key}`)}
                  selected={choice === key}
                  phLabel={`coaching_first_${key}`}
                  onPress={() => setChoice(key)}
                />
              ))}
            </View>
          </ScrollView>
          <View style={[styles.firstFooter, { paddingBottom: 21 + tabBarSpace }]}>
            <PrimaryButton label={t('coachingTab.next')} phLabel="coaching_first_next" disabled={!choice} onPress={goChoice} />
          </View>
        </View>
      ) : (
        <ScrollView contentContainerStyle={[styles.nextBody, { paddingBottom: tabBarSpace + 20 }]}>
          {/* 저번 코치 메모(노트의 다음 테이크 문장) 또는 하던 코칭 — 맨 위 카드 */}
          <View style={styles.memo}>
            <View style={styles.memoHead}>
              <View style={styles.memoAvatar}>
                <Image source={MASCOT.coach} style={styles.memoMascot} contentFit="contain" accessibilityIgnoresInvertColors />
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
                <Text style={styles.quoteLabel}>{t('coachingTab.memoNext')}</Text>
                <Text style={styles.quoteText}>{resuming ? t('coachingTab.resumeBody') : nextTake}</Text>
              </View>
            ) : null}
            <View style={styles.memoFooter}>
              <Pressable
                onPress={again}
                accessibilityRole="button"
                accessibilityLabel={t(resuming ? 'coachingTab.resume' : 'coachingTab.again')}
                ph-label={resuming ? 'coaching_resume' : 'coaching_again'}
                style={({ pressed }) => [styles.againBtn, pressed && styles.pressed]}>
                <Feather name={resuming ? 'play' : 'rotate-ccw'} size={15} color={palette.onAccent} />
                <Text style={styles.againText}>{t(resuming ? 'coachingTab.resume' : 'coachingTab.again')}</Text>
              </Pressable>
            </View>
          </View>

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

          <TalkEntryButton onPress={() => router.push('/talk')} />
          <Pressable
            onPress={pickPrevious}
            accessibilityRole="button"
            accessibilityLabel={t('coachingTab.menuResume')}
            ph-label="coaching_pick_previous"
            style={({ pressed }) => [styles.link, pressed && styles.pressed]}>
            <Feather name="clock" size={15} color={palette.textDim} />
            <Text style={styles.linkText}>{t('coachingTab.menuResume')}</Text>
          </Pressable>
          {hasScripts ? (
            <Pressable
              onPress={() => router.push('/coach-scripts')}
              accessibilityRole="button"
              accessibilityLabel={t('coachingTab.menuMyScripts')}
              ph-label="coaching_my_scripts"
              style={({ pressed }) => [styles.entryRow, styles.entryGap, pressed && styles.pressed]}>
              <View style={styles.entryIcon}>
                <Feather name="file-text" size={18} color={palette.textMuted} />
              </View>
              <View style={styles.entryText}>
                <Text style={styles.entryTitle}>{t('coachingTab.menuMyScripts')}</Text>
                <Text style={styles.entrySub}>{t('coachingTab.menuMyScriptsSub')}</Text>
              </View>
              <Feather name="chevron-right" size={18} color={palette.checkOff} />
            </Pressable>
          ) : null}
          <ScriptCocreateEntry style={styles.entryGap} />

          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>{t('coachingTab.recentTitle')}</Text>
            <Pressable onPress={() => router.push('/history')} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('coachingTab.viewAll')} ph-label="coaching_recent_all" style={styles.more}>
              <Text style={styles.moreText}>{t('coachingTab.viewAll')}</Text>
              <Feather name="chevron-right" size={14} color={palette.textFaint} />
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
        <Feather name="arrow-up-right" size={16} color={palette.checkOff} />
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.85 },

  // 처음(pen 「코칭 탭 · 처음」) — 말풍선 + 고르는 카드 셋 + 아래 「다음」.
  firstBody: { paddingTop: 16, paddingHorizontal: 24, paddingBottom: 16, gap: 28 },
  choices: { gap: 8 },
  firstFooter: { paddingHorizontal: 24 },

  // 다음 연습·하던 코칭(pen P13.3~P13.5) — 본문 padding 11/21, 메모 카드 → 타일 → 보조 줄 → 최근 코칭.
  nextBody: { paddingTop: 11, paddingHorizontal: 21 },
  memo: { gap: 16, paddingTop: 18, paddingHorizontal: 18, paddingBottom: 16, borderRadius: 22, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.card },
  memoHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  memoAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: palette.blueSoft, alignItems: 'center', justifyContent: 'center' },
  memoMascot: { width: 24, height: 26 },
  memoKind: { fontSize: 14, fontWeight: '700', color: palette.text },
  memoMeta: { marginTop: 1, fontSize: 12.5, fontWeight: '500', color: palette.textFaint },
  quote: { gap: 4, paddingLeft: 12, borderLeftWidth: 2, borderLeftColor: palette.blue },
  quoteLabel: { fontSize: 12.5, fontWeight: '600', color: palette.blueDeep },
  quoteText: { fontSize: 16, fontWeight: '600', lineHeight: 23, color: palette.text },
  memoFooter: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center' },
  againBtn: { height: 38, flexDirection: 'row', alignItems: 'center', gap: 5, paddingLeft: 12, paddingRight: 14, borderRadius: 19, backgroundColor: palette.blue },
  againText: { fontSize: 14, fontWeight: '700', color: palette.onAccent },
  tiles: { flexDirection: 'row', gap: 10, paddingTop: 12 },
  tile: { flex: 1, gap: 8, padding: 12, borderRadius: 18, backgroundColor: palette.bgSoft },
  tileAccent: { backgroundColor: palette.blueSoft },
  tileTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tileText: { gap: 4 },
  tileTitle: { fontSize: 16, fontWeight: '700', lineHeight: 22, color: palette.text },
  tileTitleAccent: { color: palette.blueDeep },
  tileSub: { fontSize: 12.5, fontWeight: '500', color: palette.textFaint },
  link: { height: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  linkText: { fontSize: 15, fontWeight: '600', color: palette.textDim },
  entryGap: { marginTop: 12 },
  entryRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 16, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.bgSoft },
  entryIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.bgSoft },
  entryText: { flex: 1, minWidth: 0, gap: 2 },
  entryTitle: { fontSize: 15, fontWeight: '800', color: palette.text },
  entrySub: { fontSize: 12, fontWeight: '500', color: palette.textMuted },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 16 },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: palette.text },
  more: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  moreText: { fontSize: 13, fontWeight: '600', color: palette.textFaint },
  recent: { paddingTop: 10, gap: 10 },
  recentRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  thumb: { width: 56, height: 56, borderRadius: 14, overflow: 'hidden', backgroundColor: palette.textStrong, alignItems: 'center', justifyContent: 'center' },
  play: { width: 22, height: 22, borderRadius: 11, backgroundColor: palette.scrim, alignItems: 'center', justifyContent: 'center' },
  recentTitle: { fontSize: 15, fontWeight: '700', color: palette.text },
  recentMeta: { marginTop: 4, fontSize: 12.5, fontWeight: '500', color: palette.textFaint },
});
