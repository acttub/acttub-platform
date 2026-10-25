import Feather from '@expo/vector-icons/Feather';
import { useFocusEffect, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { useCallback, useMemo, useState, type ComponentProps } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScriptCocreateEntry } from '@/components/script-cocreate-entry';
import { SkeletonDetail } from '@/components/ui/skeleton';
import { TalkEntryButton } from '@/components/talk-entry-button';
import { PrimaryButton } from '@/components/ui/buttons';
import { NavHeader, NavIconButton } from '@/components/ui/nav-header';
import { MASCOT } from '@/components/ui/mascot';
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
        <SkeletonDetail media lines={5} />
      ) : entry.kind === 'first' ? (
        <View style={styles.flex}>
          <ScrollView contentContainerStyle={styles.firstBody}>
            <View style={styles.introRow}>
              <Image source={MASCOT.slate} style={styles.introMascot} contentFit="contain" accessibilityIgnoresInvertColors />
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
            <ScriptCocreateEntry style={styles.entryGap} />
          </ScrollView>
          {/* 찍기·올리기는 같은 화면(app/upload)에서 고르므로 버튼 하나로 두고, 엄지 닿는 아래쪽에 붙인다(SOMA-842). */}
          <View style={[styles.firstFooter, { paddingBottom: 8 + tabBarSpace }]}>
            <PrimaryButton label={t('coachingTab.choice.video')} phLabel="coaching_first_next" onPress={startNew} />
            <Pressable onPress={() => router.push('/talk')} accessibilityRole="button" accessibilityLabel={t('coachingTab.choice.talk')} ph-label="coaching_first_talk" style={({ pressed }) => [styles.link, pressed && styles.pressed]}>
              <Feather name="message-circle" size={15} color={palette.textDim} />
              <Text style={styles.linkText}>{t('coachingTab.choice.talk')}</Text>
            </Pressable>
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

/** 처음 화면 예시 대화의 코치 줄(pen P13.1 코치 줄: 아바타 28 + 말풍선). */
function ExampleCoachLine({ text }: { text: string }) {
  return (
    <View style={styles.coachRow}>
      <View style={styles.coachAvatar}>
        <Image source={MASCOT.coach} style={styles.coachMascot} contentFit="contain" accessibilityIgnoresInvertColors />
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

  // 처음(pen P13.1·P13.2) — 액티 말풍선 · 예시 대화 · 대사 만들기 줄 · 아래 버튼 셋.
  firstBody: { paddingTop: 15, paddingHorizontal: 20, paddingBottom: 16 },
  introRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 13, paddingLeft: 6 },
  introMascot: { width: 52, height: 61, marginBottom: 4 },
  introBubble: { flex: 1, minWidth: 0, gap: 5, paddingTop: 11, paddingHorizontal: 14, paddingBottom: 12, borderRadius: 16, backgroundColor: palette.bgSoft },
  introTitle: { fontSize: 19, fontWeight: '700', lineHeight: 25, color: palette.text },
  introBody: { fontSize: 15, fontWeight: '600', lineHeight: 20, color: palette.textMuted },
  exampleLabel: { paddingTop: 28, paddingBottom: 10, fontSize: 13, fontWeight: '700', color: palette.textMuted },
  example: { gap: 10, padding: 16, borderRadius: 20, backgroundColor: palette.bgSoft },
  exampleVideo: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 10, paddingVertical: 8, paddingLeft: 8, paddingRight: 12, borderRadius: 14, backgroundColor: palette.card },
  exampleThumb: { width: 40, height: 40, borderRadius: 10, backgroundColor: palette.textStrong, alignItems: 'center', justifyContent: 'center' },
  exampleVideoText: { gap: 1 },
  exampleVideoTitle: { fontSize: 13.5, fontWeight: '700', color: palette.text },
  exampleVideoSub: { fontSize: 12, fontWeight: '500', color: palette.textFaint },
  coachRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  coachAvatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: palette.blueSoft, alignItems: 'center', justifyContent: 'center' },
  coachMascot: { width: 19, height: 20 },
  coachBubble: { flexShrink: 1, paddingVertical: 9, paddingHorizontal: 12, borderTopLeftRadius: 14, borderTopRightRadius: 14, borderBottomRightRadius: 14, borderBottomLeftRadius: 4, backgroundColor: palette.card },
  coachText: { fontSize: 14, fontWeight: '600', lineHeight: 20, color: palette.text },
  exampleMeRow: { flexDirection: 'row', justifyContent: 'flex-end' },
  exampleMe: { paddingVertical: 9, paddingHorizontal: 12, borderTopLeftRadius: 14, borderTopRightRadius: 14, borderBottomLeftRadius: 14, borderBottomRightRadius: 4, backgroundColor: palette.blue },
  exampleMeText: { fontSize: 14, fontWeight: '500', lineHeight: 20, color: palette.onAccent },
  exampleNote: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: 12, paddingHorizontal: 2 },
  exampleNoteText: { flex: 1, fontSize: 13, fontWeight: '600', color: palette.textMuted },
  firstFooter: { gap: 4, paddingTop: 8, paddingHorizontal: 20 },

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
