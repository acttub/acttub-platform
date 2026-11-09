import Feather from '@expo/vector-icons/Feather';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { useEffect, useMemo, useState, type ComponentProps } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SkeletonBlock, SkeletonGroup, SkeletonLine } from '@/components/ui/skeleton';
import { PrimaryButton } from '@/components/ui/buttons';
import { NavHeader, NavIconButton } from '@/components/ui/nav-header';
import { MASCOT } from '@/components/ui/mascot';
import { StatusScreen } from '@/components/ui/status-screen';
import { useTabBarSpace } from '@/components/ui/tab-bar';
import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';
import { useFirstTimeUser } from '@/hooks/use-first-time-user';
import { useNextTakes } from '@/hooks/use-next-takes';
import { useFocusLoad } from '@/hooks/use-focus-load';
import { api } from '@/lib/api';
import { dateLocale, translate as t } from '@/lib/i18n';
import { coachingEntry, type CoachingEntry } from '@/lib/practice/coaching-entry';
import { groupPoster, groupRowTarget, recentGroups, sceneTitle } from '@/lib/practice/groups';
import { continueActionFor } from '@/lib/practice/resume';
import { setContinueOrigin } from '@/lib/practice/session-state';
import type { PracticeGroup } from '@/lib/practice/types';
import { lastRead } from '@/lib/last-reads';
import { rememberSkeletonHints, useSkeletonHints } from '@/lib/skeleton-hint';

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
  // 홈이 앱을 켤 때 받은 묶음이 있으면 그것으로 바로 그린다. 들어올 때마다 새로 받아 칸만 바꾼다(lib/last-reads).
  const [shared] = useState(() => lastRead<{ groups: PracticeGroup[] }>('practiceGroups')?.groups ?? null);
  const [entry, setEntry] = useState<CoachingEntry | null>(() => (shared ? coachingEntry(shared) : null));
  // 묶음을 못 받아 처음 화면으로 넘어간 경우 — 뼈대 기억(lib/skeleton-hint)에 적지 않는다.
  const [entryFailed, setEntryFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // 다시 시도를 눌러 받는 중 — 같은 오류 화면이 그대로라 버튼이 눌렸는지 보이게 한다.
  const [retrying, setRetrying] = useState(false);
  const [groups, setGroups] = useState<PracticeGroup[]>(() => shared ?? []);
  const takes = useNextTakes([entry?.kind === 'next' ? entry.notePracticeId : null]);
  const nextTake = entry?.kind === 'next' ? (takes[entry.notePracticeId] ?? null) : null;
  const visible = useMemo(() => recentGroups(groups, groups.length), [groups]);

  useFocusLoad(
    (alive) => {
      api
        .listPracticeGroups('all')
        .then(({ groups: list }) => {
          if (!alive()) return;
          setRetrying(false);
          setGroups(list);
          setEntry(coachingEntry(list));
          setEntryFailed(false);
        })
        .catch(() => {
          if (!alive()) return;
          setRetrying(false);
          setEntry({ kind: 'first' });
          setEntryFailed(true);
        });
    },
    [attempt],
  );

  // 받기 전 화면은 이 기기에서 지난번에 실제로 그린 모양(lib/skeleton-hint)을 따른다.
  // - 처음 화면이었으면(또는 이 탭 기억은 없지만 홈이 첫 사용자로 확인했으면) 실제 처음 화면을 바로 그린다. 고정 화면이라 받을 것이 없다.
  // - 다음 연습 화면이었으면 같은 틀에 받는 칸만 회색인 뼈대를 그린다. 아무 기억도 없을 때만 처음 모양 회색 뼈대다.
  const skeletonHints = useSkeletonHints();
  const firstHint = skeletonHints.coaching === 'first' || (!skeletonHints.coaching && firstTime);
  const first = entry ? entry.kind === 'first' : firstHint;
  useEffect(() => {
    if (!entry || entryFailed) return;
    rememberSkeletonHints(
      entry.kind === 'first' ? { coaching: 'first' } : { coaching: 'next', coachingRows: Math.min(RECENT_COUNT, visible.length) },
    );
  }, [entry, entryFailed, visible.length]);
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
      {/* 못 받았을 때 처음 화면으로 넘어가지 않는다 — 첫 사용자 화면은 받을 것이 없어 그대로 둔다. */}
      {entryFailed && !firstHint ? (
        <StatusScreen title={t('history.loadFail')} body={t('settings.retryLater')} primary={{
            label: t('common.retry'),
            loading: retrying,
            onPress: () => {
              setRetrying(true);
              setAttempt((n) => n + 1);
            },
          }} />
      ) : !entry && !first ? (
        skeletonHints.coaching === 'next' ? (
          <CoachingNextSkeleton rows={skeletonHints.coachingRows ?? RECENT_COUNT} bottomSpace={tabBarSpace + space[5]} />
        ) : (
          <CoachingFirstSkeleton bottomSpace={space[2] + tabBarSpace} />
        )
      ) : first || !entry || entry.kind === 'first' ? (
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
                <Feather name="arrow-right" size={15} color={palette.blueDeep} />
              </View>
            </View>
          </Pressable>

          <View style={styles.tiles}>
            <Tile icon="video" title={t('coachingTab.newVideo')} sub={t('coachingTab.newVideoSub')} accent phLabel="coaching_new_video" onPress={startNew} />
            {/* 「지난 코칭 다시 보기」 큰 버튼 자리에 「다른 방법으로 코칭 받기」를 같은 모양으로 둔다(11/2 폰 QA). 지난 코칭은 아래 「최근 코칭」의 상세보기로 간다. */}
            <Tile
              icon="message-circle"
              title={t('coachingTab.otherWaysTile')}
              sub={t('coachingTab.otherWaysSub')}
              phLabel="coaching_other_ways"
              onPress={() => router.push('/coach-other')}
            />
          </View>

          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>{t('coachingTab.recentTitle')}</Text>
            <Pressable
              onPress={() => router.push('/history')}
              accessibilityRole="button"
              accessibilityLabel={t('coachingTab.historyLinkA11y')}
              ph-label="coaching_history"
              hitSlop={8}
              style={({ pressed }) => [styles.historyLink, pressed && styles.pressed]}>
              <Text style={styles.historyLinkText}>{t('coachingTab.historyLink')}</Text>
              <Feather name="chevron-right" size={16} color={palette.iconFaint} />
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

/**
 * 처음 화면 뼈대(기억이 없을 때만) — 액티 말풍선과 「코칭은 이렇게 해요」는 고정 글이라 그대로, 예시 대화·아래 링크·버튼 자리는 회색.
 */
function CoachingFirstSkeleton({ bottomSpace }: { bottomSpace: number }) {
  return (
    <SkeletonGroup style={styles.flex}>
      <View style={[styles.flex, styles.firstBody]}>
        <View style={styles.introRow}>
          <Image source={MASCOT.slate} style={styles.introMascot} contentFit="contain" cachePolicy="memory-disk" accessibilityIgnoresInvertColors />
          <View style={styles.introBubble}>
            <Text style={styles.introTitle}>{t('coachingTab.firstTitle')}</Text>
            <Text style={styles.introBody}>{t('coachingTab.firstBody')}</Text>
          </View>
        </View>
        <Text style={styles.exampleLabel}>{t('coachingTab.exampleLabel')}</Text>
        <SkeletonBlock height={266} radius={radius.lg} />
        <SkeletonLine size={type.caption} width="72%" style={{ marginTop: space[3] }} />
      </View>
      <View style={[styles.firstFooter, { paddingBottom: bottomSpace }]}>
        <View style={styles.link}>
          <SkeletonLine size={type.body2Bold} width={200} />
        </View>
        <SkeletonBlock height={48} radius={radius.lg} />
      </View>
    </SkeletonGroup>
  );
}

/** 다음 연습 화면 뼈대 — 메모 카드·타일 둘·「다른 방법」 줄·최근 코칭 순서와 높이를 실제와 같게 둔다. */
function CoachingNextSkeleton({ rows, bottomSpace }: { rows: number; bottomSpace: number }) {
  return (
    <SkeletonGroup style={styles.flex}>
      <ScrollView contentContainerStyle={[styles.nextBody, { paddingBottom: bottomSpace }]} scrollEnabled={false}>
        <View style={styles.memo}>
          <View style={styles.memoHead}>
            <View style={styles.memoAvatar}>
              <Image source={MASCOT.coach} style={styles.memoMascot} contentFit="contain" cachePolicy="memory-disk" accessibilityIgnoresInvertColors />
            </View>
            <View style={styles.flex}>
              <SkeletonLine size={type.body2Bold} width="34%" />
              <SkeletonLine size={type.caption} width="46%" />
            </View>
          </View>
          <View style={styles.memoFooter}>
            <SkeletonLine size={type.body2Bold} width={88} />
          </View>
        </View>
        <View style={styles.tiles}>
          <SkeletonBlock height={125} radius={radius.lg} style={styles.flex} />
          <SkeletonBlock height={125} radius={radius.lg} style={styles.flex} />
        </View>
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>{t('coachingTab.recentTitle')}</Text>
          <SkeletonLine size={type.caption} width={52} />
        </View>
        <View style={styles.recent}>
          {Array.from({ length: rows }, (_, i) => (
            <View key={i} style={styles.recentRow}>
              <SkeletonBlock width={44} height={44} radius={radius.sm} />
              <View style={styles.flex}>
                <SkeletonLine size={type.body2Bold} width={i === 0 ? '36%' : '44%'} />
                <SkeletonLine size={type.caption} width="22%" style={{ marginTop: 2 }} />
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
    </SkeletonGroup>
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
      style={({ pressed }) => [styles.tile, pressed && styles.pressed]}>
      <View style={styles.tileTop}>
        <Feather name={icon} size={22} color={accent ? palette.blue : palette.text} />
        <Feather name="arrow-up-right" size={16} color={palette.iconFaint} />
      </View>
      <View style={styles.tileText}>
        <Text style={styles.tileTitle}>{title}</Text>
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
  againText: { ...type.body2Bold, color: palette.blueDeep },
  tiles: { flexDirection: 'row', gap: space[2], paddingTop: space[3] },
  tile: { flex: 1, gap: space[2], padding: space[3], borderRadius: radius.lg, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.bg },
  tileTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tileText: { gap: space[1] },
  tileTitle: { ...type.body1Bold, color: palette.text },
  tileSub: { ...type.micro, color: palette.textMeta },
  linkRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space[3] },
  linkSep: { width: 1, height: 12, backgroundColor: palette.border },
  link: { height: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space[1.5] },
  linkText: { ...type.body2Bold, color: palette.textSub },
  // Button/Text — 알약 바탕 없는 보조 글자 버튼.
  historyLink: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  historyLinkText: { ...type.body2Bold, color: palette.textSub },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: space[6] },
  sectionTitle: { ...type.body1Bold, color: palette.text },
  recent: { paddingTop: space[3], gap: space[3] },
  recentRow: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  thumb: { width: 44, height: 44, borderRadius: radius.sm, overflow: 'hidden', backgroundColor: palette.bgSoft, alignItems: 'center', justifyContent: 'center' },
  play: { width: 20, height: 20, borderRadius: radius.full, backgroundColor: palette.scrim, alignItems: 'center', justifyContent: 'center' },
  recentTitle: { ...type.body2Bold, color: palette.text },
  recentMeta: { marginTop: 2, ...type.caption, color: palette.textMeta },
});
