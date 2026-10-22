import Feather from '@expo/vector-icons/Feather';
import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState, type ComponentProps } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

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

/** 「최근 코칭」에 보이는 묶음 수(pen 「코칭 탭 · 다음 연습」). */
const RECENT_COUNT = 2;

function shortDate(iso: string | null | undefined): string {
  const d = new Date(iso ?? '');
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(dateLocale(), { month: 'long', day: 'numeric' });
}

/**
 * 코칭 탭(pen 「코칭 탭 · 처음 · 개선안」·「코칭 탭 · 다음 연습」). 가운데 촬영 버튼을 대신해 코칭을 시작하는 곳이다.
 *
 * - 처음: 「코칭이 처음이죠?」 말풍선 + 고정 예시 대화 카드, 아래 「지금 찍어서 코칭 받기」(찍는 법 → 카메라 → 새 연습 준비)와
 *   「찍어 둔 영상 올리기」(새 연습 준비).
 * - 다음: 저번 코치 메모(노트의 다음 테이크 문장) + 「한 번 더 연습」, 새 영상·지난 코칭 타일, 최근 코칭 두 줄.
 *
 * 디자인의 「n/3번 해 봤어요」 진행 점, 최근 코칭 줄의 태그(감정 기억·해결)·영상 길이는 서버에 그 값이 없어 그리지 않는다.
 * 서버 기능이 아직 없는 길(하루 무료 횟수 안내)은 보이지 않는다. 「영상 없이 말로 코칭 받기」는 목적 화면(app/talk)을 연다(SOMA-745).
 * 「찍을 대사부터 같이 만들기」는 처음 화면의 예시 아래와 다음 연습의 타일 아래에 있다(SOMA-721).
 */
export default function CoachingTab() {
  const tabBarSpace = useTabBarSpace();
  const router = useRouter();
  const firstTime = useFirstTimeUser();
  const [entry, setEntry] = useState<CoachingEntry | null>(null);
  const [groups, setGroups] = useState<PracticeGroup[]>([]);
  // 「다음엔 이렇게 해 봐요」는 노트의 다음 테이크 문장이다. 없으면 그 칸을 띄우지 않는다.
  const takes = useNextTakes([entry?.kind === 'next' ? entry.notePracticeId : null]);
  const nextTake = entry?.kind === 'next' ? takes[entry.notePracticeId] ?? null : null;
  // 지난 코칭(숨기지 않은 묶음) — 타일의 개수와 최근 코칭 줄이 같은 목록을 본다.
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
  // 새 연습은 세션 목적 → 영상 고르기 순서다(app/upload). 첫 코칭이면 단계마다 파란 안내를 켠다.
  const startNew = () => router.push({ pathname: '/upload', params: first ? { first: '1' } : {} });
  // 지금 찍기 — 찍는 법 한 장 → 카메라 → 찍은 영상을 들고 새 연습 준비로 간다(next=upload).
  const recordNow = () =>
    router.push({ pathname: '/record-guide', params: first ? { next: 'upload', first: '1' } : { next: 'upload' } });

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

  const noteAt =
    entry?.kind === 'next'
      ? entry.group.practices.find((p) => p.id === entry.notePracticeId)?.created_at ?? entry.group.last_practiced_at
      : entry?.kind === 'resume'
        ? entry.group.last_practiced_at
        : null;
  const resuming = entry?.kind === 'resume';
  // 대화가 열린 회차가 있으면 「한 번 더 연습」도 그 대화로 이어진다 — 버튼 이름을 「이어서 하기」로 맞춘다.
  const againLabel =
    resuming || (entry?.kind === 'next' && continueActionFor(entry.group).kind === 'resume') ? t('coachingTab.resume') : t('coachingTab.again');

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
            <MascotBubble source={MASCOT.slate} title={t('coachingTab.firstBubble')} body={t('coachingTab.firstBubbleSub')} />
            <Text style={styles.exampleTitle}>{t('coachingTab.exampleTitle')}</Text>
            <CoachingExample />
            <View style={styles.caption}>
              <Feather name="message-circle" size={15} color={palette.blue} />
              <Text style={styles.captionText}>{t('coachingTab.exampleCaption')}</Text>
            </View>
            {/* 찍을 대본이 없으면 대사부터 같이 만든다(SOMA-721). */}
            <ScriptCocreateEntry style={styles.cocreate} />
          </ScrollView>
          <View style={[styles.firstFooter, { paddingBottom: 21 + tabBarSpace }]}>
            <PrimaryButton label={t('coachingTab.recordNow')} phLabel="coaching_first_record" onPress={recordNow} />
            <Pressable
              onPress={startNew}
              accessibilityRole="button"
              accessibilityLabel={t('coachingTab.uploadTaken')}
              ph-label="coaching_first_upload"
              style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}>
              <Feather name="upload" size={15} color={palette.textDim} />
              <Text style={styles.secondaryText}>{t('coachingTab.uploadTaken')}</Text>
            </Pressable>
            <TalkEntryButton onPress={() => router.push('/talk')} />
          </View>
        </View>
      ) : (
        <ScrollView contentContainerStyle={[styles.nextBody, { paddingBottom: tabBarSpace + 20 }]}>
          {/* 저번 코치 메모 — 노트가 있는 가장 최근 묶음의 다음 테이크 문장. */}
          <View style={styles.memo}>
            <View style={styles.memoHead}>
              <View style={styles.memoAvatar}>
                <Image source={MASCOT.coach} style={styles.memoMascot} contentFit="contain" accessibilityIgnoresInvertColors />
              </View>
              <View style={styles.flex}>
                <Text style={styles.memoKind}>{resuming ? t('coachingTab.resumeKind') : t('coachingTab.memoKind')}</Text>
                <Text style={styles.memoMeta} numberOfLines={1}>
                  {[shortDate(noteAt), sceneTitle(entry.group)].filter(Boolean).join(' · ')}
                </Text>
              </View>
            </View>
            {resuming ? (
              <View style={styles.quote}>
                <Text style={styles.quoteText}>{t('coachingTab.resumeBody')}</Text>
              </View>
            ) : nextTake ? (
              <View style={styles.quote}>
                <Text style={styles.quoteLabel}>{t('coachingTab.memoNext')}</Text>
                <Text style={styles.quoteText}>{nextTake}</Text>
              </View>
            ) : null}
            <View style={styles.memoFooter}>
              <Pressable
                onPress={again}
                accessibilityRole="button"
                accessibilityLabel={againLabel}
                ph-label={resuming ? 'coaching_resume' : 'coaching_again'}
                style={({ pressed }) => [styles.againBtn, pressed && styles.pressed]}>
                <Feather name={againLabel === t('coachingTab.again') ? 'rotate-ccw' : 'play'} size={15} color={palette.onAccent} />
                <Text style={styles.againText}>{againLabel}</Text>
              </Pressable>
            </View>
          </View>

          <View style={styles.tiles}>
            <Tile
              icon="video"
              title={t('coachingTab.newVideo')}
              sub={t('coachingTab.newVideoSub')}
              accent
              phLabel="coaching_new_video"
              onPress={startNew}
            />
            <Tile
              icon="clock"
              title={t('coachingTab.history')}
              sub={t('coachingTab.historyCount', { count: visible.length })}
              phLabel="coaching_history"
              onPress={() => router.push('/history')}
            />
          </View>
          <TalkEntryButton onPress={() => router.push('/talk')} />

          <ScriptCocreateEntry style={styles.cocreate} />

          {visible.length > 0 && (
            <>
              <View style={styles.sectionHead}>
                <Text style={styles.sectionTitle}>{t('coachingTab.recentTitle')}</Text>
                <Pressable onPress={() => router.push('/history')} hitSlop={8} accessibilityRole="button" ph-label="coaching_recent_all" style={styles.more}>
                  <Text style={styles.moreText}>{t('coachingTab.viewAll')}</Text>
                  <Feather name="chevron-right" size={14} color={palette.textFaint} />
                </Pressable>
              </View>
              <View style={styles.recent}>
                {visible.slice(0, RECENT_COUNT).map((g) => {
                  const poster = groupPoster(g);
                  return (
                    <Pressable
                      key={g.root_id}
                      // 대화 중인 묶음은 그 대화로 바로 돌아간다(SOMA-672).
                      onPress={() => router.push(groupRowTarget(g))}
                      accessibilityRole="button"
                      style={({ pressed }) => [styles.recentRow, pressed && styles.pressed]}>
                      <View style={styles.thumb}>
                        {poster ? (
                          <Image source={{ uri: poster.uri, cacheKey: poster.cacheKey }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} />
                        ) : null}
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
            </>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

/** 「코칭은 이렇게 해요」 — 고정 예시 대화(pen 그대로). 실제 기록이 아니다. */
function CoachingExample() {
  return (
    <View style={styles.example}>
      <View style={styles.exVideo}>
        <View style={styles.exThumb}>
          <Feather name="play" size={14} color={palette.onAccent} />
        </View>
        <View>
          <Text style={styles.exVideoTitle}>{t('coachingTab.exampleVideo')}</Text>
          <Text style={styles.exVideoSub}>{t('coachingTab.exampleVideoSub')}</Text>
        </View>
      </View>
      <CoachLine text={t('coachingTab.exampleCoach1')} />
      <View style={styles.meRow}>
        <View style={styles.meBubble}>
          <Text style={styles.meText}>{t('coachingTab.exampleMe')}</Text>
        </View>
      </View>
      <CoachLine text={t('coachingTab.exampleCoach2')} />
    </View>
  );
}

function CoachLine({ text }: { text: string }) {
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

  // 처음(pen 「코칭 탭 · 처음 · 개선안」)
  firstBody: { paddingTop: 15, paddingHorizontal: 20, paddingBottom: 16 },
  exampleTitle: { marginTop: 28, marginBottom: 10, fontSize: 13, fontWeight: '700', color: palette.textMuted },
  example: { gap: 10, padding: 16, borderRadius: 20, backgroundColor: palette.bgSoft },
  exVideo: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingLeft: 8,
    paddingRight: 12,
    borderRadius: 14,
    backgroundColor: palette.card,
  },
  exThumb: { width: 40, height: 40, borderRadius: 10, backgroundColor: palette.textStrong, alignItems: 'center', justifyContent: 'center' },
  exVideoTitle: { fontSize: 13.5, fontWeight: '700', color: palette.text },
  exVideoSub: { marginTop: 1, fontSize: 12, fontWeight: '500', color: palette.textFaint },
  coachRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  coachAvatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: palette.blueSoft, alignItems: 'center', justifyContent: 'center' },
  coachMascot: { width: 19, height: 20 },
  coachBubble: {
    flexShrink: 1,
    paddingVertical: 9,
    paddingHorizontal: 12,
    backgroundColor: palette.card,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    borderBottomRightRadius: 14,
    borderBottomLeftRadius: 4,
  },
  coachText: { fontSize: 14, fontWeight: '600', lineHeight: 20, color: palette.text },
  meRow: { flexDirection: 'row', justifyContent: 'flex-end' },
  meBubble: {
    flexShrink: 1,
    paddingVertical: 9,
    paddingHorizontal: 12,
    backgroundColor: palette.blue,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    borderBottomRightRadius: 4,
    borderBottomLeftRadius: 14,
  },
  meText: { fontSize: 14, fontWeight: '500', lineHeight: 20, color: palette.onAccent },
  caption: { marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 2 },
  captionText: { flexShrink: 1, fontSize: 13, fontWeight: '600', color: palette.textMuted },
  firstFooter: { gap: 4, paddingHorizontal: 20 },
  // 탭바가 보이면(첫 사용자가 아니면) 화면 위에 떠 있는 탭바만큼 버튼을 올린다.
  secondary: { height: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  secondaryText: { fontSize: 15, fontWeight: '600', color: palette.textDim },
  cocreate: { marginTop: 12 },

  // 다음 연습(pen 「코칭 탭 · 다음 연습」)
  nextBody: { paddingTop: 11, paddingHorizontal: 21 },
  memo: {
    gap: 16,
    paddingTop: 18,
    paddingHorizontal: 18,
    paddingBottom: 16,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.card,
    shadowColor: palette.navy,
    shadowOpacity: 0.05,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  memoHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  memoAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: palette.blueSoft, alignItems: 'center', justifyContent: 'center' },
  memoMascot: { width: 24, height: 26 },
  memoKind: { fontSize: 14, fontWeight: '700', color: palette.text },
  memoMeta: { marginTop: 1, fontSize: 12.5, fontWeight: '500', color: palette.textFaint },
  quote: { gap: 4, paddingLeft: 12, borderLeftWidth: 3, borderLeftColor: palette.blue },
  quoteLabel: { fontSize: 12.5, fontWeight: '600', color: palette.blueDeep },
  quoteText: { fontSize: 16, fontWeight: '600', lineHeight: 24, color: palette.text },
  memoFooter: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center' },
  againBtn: {
    height: 38,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingLeft: 12,
    paddingRight: 14,
    borderRadius: 19,
    backgroundColor: palette.blue,
  },
  againText: { fontSize: 14, fontWeight: '700', color: palette.onAccent },
  tiles: { marginTop: 12, flexDirection: 'row', gap: 10 },
  tile: { flex: 1, gap: 8, padding: 12, borderRadius: 18, backgroundColor: palette.bgSoft },
  tileAccent: { backgroundColor: palette.blueSoft },
  tileTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tileText: { gap: 4 },
  tileTitle: { fontSize: 16, fontWeight: '700', lineHeight: 21, color: palette.text },
  tileTitleAccent: { color: palette.blueDeep },
  tileSub: { fontSize: 12.5, fontWeight: '500', color: palette.textFaint },
  sectionHead: { marginTop: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: palette.text },
  more: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  moreText: { fontSize: 13, fontWeight: '600', color: palette.textFaint },
  recent: { marginTop: 10, gap: 10 },
  recentRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  thumb: {
    width: 56,
    height: 56,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: palette.textStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  play: { width: 22, height: 22, borderRadius: 11, backgroundColor: palette.scrim, alignItems: 'center', justifyContent: 'center' },
  recentTitle: { fontSize: 15, fontWeight: '700', color: palette.text },
  recentMeta: { marginTop: 4, fontSize: 12.5, fontWeight: '500', color: palette.textFaint },
});
