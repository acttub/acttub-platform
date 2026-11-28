import Feather from '@expo/vector-icons/Feather';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useFocusEffect, useRouter } from 'expo-router';
import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Image, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { sanitizeInput } from '@/lib/practice/readable-text';
import { AdSlot } from '@/components/ad-slot';
import CoachingSection from '@/components/practice/coaching-pane';
import { PracticeSteps, type PracticeStepKey } from '@/components/practice/practice-steps';
import { startSceneCoaching } from '@/hooks/scene-coaching';
import { useFocusLoad } from '@/hooks/use-focus-load';
import { useNextTakes } from '@/hooks/use-next-takes';
import { useSceneStart } from '@/hooks/use-scene-start';
import { logEvent } from '@/lib/analytics';
import { api } from '@/lib/api';
import { coachingEntry } from '@/lib/practice/coaching-entry';
import { currentFirstUseOwner } from '@/lib/practice/first-use-graduation';
import { lastNotePracticeId, sceneTitle } from '@/lib/practice/groups';
import { coachGroupFor, knownSceneTakes, lastHandledScript, loadSceneTakes, practiceStepOf, type PracticeStep, type SceneTakes } from '@/lib/practice/scene-takes';
import type { PracticeGroup } from '@/lib/practice/types';
import { SpotlightGuide, type SpotlightStep } from '@/components/spotlight-guide';
import { SplitJobRow } from '@/components/reading/split-job-row';
import { BandGradient } from '@/components/ui/band-gradient';
import { Button } from '@/components/ui/buttons';
import { InlineEmpty } from '@/components/ui/inline-empty';
import { InlineError } from '@/components/ui/inline-error';
import { BlueSwitch } from '@/components/ui/list-rows';
import { SkeletonBlock, SkeletonGroup, SkeletonLine } from '@/components/ui/skeleton';
import { heroCard } from '@/constants/hero-card';
import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';
import { useCloudVoice } from '@/hooks/use-cloud-voice';
import { useSpotlightTarget } from '@/hooks/use-spotlight-target';
import { useSplitJobs } from '@/hooks/use-split-jobs';
import { hasSeenReadingTutorial, hasSeenSpotlight, markReadingTutorialSeen, markSpotlightSeen } from '@/lib/guide-state';
import { skipsReadingTabGuide } from '@/lib/returning-account';
import { TARGET } from '@/lib/spotlight-targets';
import { useAppDialog } from '@/components/app-dialog';
import { TitleEditDialog } from '@/components/title-edit-dialog';
import { NavHeader, NavIconButton } from '@/components/ui/nav-header';
import { useFirstTimeUser } from '@/hooks/use-first-time-user';
import { useTabBarSpace } from '@/components/ui/tab-bar';
import { myCharactersLabel } from '@/lib/reading/script-cards';
import { resumeSessionOf } from '@/lib/reading/redesign-748';
import { scriptErrorMessage } from '@/lib/reading/script-errors';
import { lastRead, rememberRead } from '@/lib/last-reads';
import { deleteScript, listScripts, listSessions, loadIntoCurrent } from '@/lib/reading/store';
import { openResume } from '@/lib/reading/resume-open';
import type { ScriptCard, ScriptListResponse, SessionCard } from '@/lib/reading/types';
import { isKorean, translate as t } from '@/lib/i18n';
import { rememberSkeletonHints, useSkeletonHints } from '@/lib/skeleton-hint';
import type { GestureResponderEvent } from 'react-native';

import { pt } from '@/components/ui/anchored-menu';

/**
 * 내 대본 목록(R00, reading.script). 서버 목록이 정본이다 — 최근 고친 순, 머리 "전체 N개 · 연습 중 M개",
 * 카드마다 제목·내 배역·대사 수·녹음 수·마지막 활동·상태 칩(연습 중·연습 완료, 배역을 안 골랐으면 없음). 검색은 서버가
 * 제목과 배역 이름만 찾는다. "분석 완료" 칩은 리딩에 분석이 없어 없다.
 */
const SEARCH_DEBOUNCE_MS = 300;

type EntryKey = 'upload' | 'sample' | 'make';
const ENTRY_CHOICES: { key: EntryKey; title: string; sub: string; primary?: boolean }[] = [
  { key: 'upload', title: 'reading.entryUpload', sub: 'reading.entryUploadSub', primary: true },
  { key: 'sample', title: 'reading.entrySample', sub: 'reading.entrySampleSub' },
  { key: 'make', title: 'reading.entryMake', sub: 'reading.entryMakeSub' },
];
const ENTRY_ART: Partial<Record<EntryKey, number>> = {
  upload: require('@/assets/images/reading/upload-folder-3d.png'),
  sample: require('@/assets/images/reading/sample-script-3d.png'),
};
const HERO_ACTY = require('@/assets/images/reading/hero-acty-stack.png');
/** 입구 화면 위 띠. 24색 밖이라 이 파일 안에만 둔다(디자인 시스템 pen 「의도된 차이」). */
const ENTRY_TOP = '#E4EEFC';
/** 띠가 흰색이 되는 화면 y. */
const ENTRY_FADE_END = 310;
const ROW_ICON_WIDTH = 24;

/** 대본 탭에서 처음 한 번 비추는 자리 — 대본을 들이는 버튼 하나뿐이다 (SOMA-550). */
const READING_STEPS: SpotlightStep[] = [{ target: TARGET.readingNew, text: 'guide.spotReadingNew' }];

/** 대본 하나의 「다음 할 일」 — 카드 버튼·줄 글자 버튼이 같이 쓴다(practice_next_tap { action }). */
type NextAction = 'read' | 'shoot' | 'coach' | 'again';
const ACTION_OF: Record<PracticeStep, NextAction> = { reading: 'read', read: 'shoot', shot: 'coach', coached: 'again' };
const ROW_GO: Record<PracticeStep, string> = {
  reading: 'practiceTab.rowGoRead',
  read: 'practiceTab.rowGoShoot',
  shot: 'practiceTab.rowGoCoach',
  coached: 'practiceTab.rowGoAgain',
};
/** 「다음 할 일」 카드 — 마지막으로 다룬 대본 하나와 그 단계. 리딩 중이면 진행 중 회차, 리딩 끝이면 끝낸 회차 수를 함께 든다. */
type NextCard = { script: ScriptCard; step: PracticeStep; session: SessionCard | null; readCount: number };

/**
 * 연습 탭 한 페이지(시안 B3 + 촬영 단계). 위에서부터:
 * 제목 「연습」 → 단계 칸 셋(① 대사 익히기 → ② 촬영하기 → ③ 코칭 받기) → 고품질 목소리 띠 → 「다음 할 일」 파란 카드 → 새 대본 →
 * 광고 칸 → 내 대본(검색·줄마다 다음 할 일) → 코칭 구역(저번 코치 메모·다른 방법·최근 코칭, components/practice/coaching-pane).
 * 대본이 없으면 카드·목록 자리에 예전 리딩 입구(올리기·예시·만들기)가 그대로 온다.
 *
 * 대본별 단계는 lib/practice/scene-takes 가 앱에서 판정한다 — ①은 서버 대본 카드, ②③은 이 기기에 남긴 기록이라
 * 기기를 바꾸면 ②③ 표시가 빈다(서버에 대본별 단계 값이 없다).
 *
 * `focusCoaching`(주소 /practice?mode=coaching)이면 코칭 구역으로 한 번 내려 준다.
 */
export default function ReadingList({ focusCoaching = false }: { focusCoaching?: boolean } = {}) {
  const tabBarSpace = useTabBarSpace();
  const router = useRouter();
  const firstTime = useFirstTimeUser();
  const insets = useSafeAreaInsets();
  // iOS 당기기 표시는 스크롤 맨 위(상태 표시줄·다이내믹 아일랜드 밑)에 뜬다 — 위 여백을 contentInset 으로 줘야 그 아래에 보인다(SOMA-964).
  const iosTopInset = Platform.OS === 'ios' ? insets.top : 0;
  const cloudVoice = useCloudVoice();
  const refreshVoice = cloudVoice.refresh;
  const voiceFreeUntil = cloudVoice.status?.free_until
    ? new Date(cloudVoice.status.free_until).toLocaleDateString(isKorean() ? 'ko-KR' : 'en-US', { month: 'long', day: 'numeric' })
    : '';
  const { confirm, sheet, alert, dialog } = useAppDialog();
  // 홈이 앱을 켤 때 받은 대본 목록이 있으면 그것으로 바로 그린다. 들어올 때마다 새로 받아 칸만 바꾼다(lib/last-reads).
  const [list, setList] = useState<ScriptListResponse | null>(() => lastRead<ScriptListResponse>('readingScripts') ?? null);
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ScriptCard | null>(null);
  /** 「다음 할 일」 카드(예전 「이전에 하던 데부터」 카드와 같은 모양) — 마지막으로 다룬 대본의 다음 단계. */
  // 지난번 카드를 먼저 보인다 — 목록을 받고 회차까지 받은 뒤에 카드가 끼어들어 목록이 밀렸다(11/3 폰 QA).
  const [resume, setResumeState] = useState<NextCard | null>(() => lastRead<NextCard | null>('readingResume') ?? null);
  const setResume = useCallback((next: NextCard | null) => {
    rememberRead('readingResume', next);
    setResumeState(next);
  }, []);
  const [resuming, setResuming] = useState(false);
  // 대본별 ②③ 기록(이 기기, 계정별). 이번 실행에서 읽었으면 바로 그린다.
  const [takes, setTakes] = useState<SceneTakes>(() => knownSceneTakes(currentFirstUseOwner()) ?? {});
  const sceneStart = useSceneStart();
  // 코칭 묶음 — 아래 코칭 구역과 카드의 코치 메모가 같이 쓴다. 홈이 받은 것이 있으면 그것으로 먼저 그린다(lib/last-reads).
  const [groups, setGroups] = useState<PracticeGroup[] | null>(() => lastRead<{ groups: PracticeGroup[] }>('practiceGroups')?.groups ?? null);
  const [groupsFailed, setGroupsFailed] = useState(false);
  const [groupsAttempt, setGroupsAttempt] = useState(0);
  useFocusLoad(
    (alive) => {
      api
        .listPracticeGroups('all')
        .then(({ groups: list }) => {
          if (!alive()) return;
          setGroups(list);
          setGroupsFailed(false);
        })
        .catch(() => {
          if (alive()) setGroupsFailed(true);
        });
    },
    [groupsAttempt],
  );
  const scrollRef = useRef<ScrollView>(null);
  const coachingY = useRef<number | null>(null);
  const scrolledToCoaching = useRef(false);
  const scrollToCoaching = useCallback(() => {
    if (!focusCoaching || scrolledToCoaching.current || coachingY.current === null) return;
    scrolledToCoaching.current = true;
    scrollRef.current?.scrollTo({ y: coachingY.current, animated: false });
  }, [focusCoaching]);
  useEffect(() => {
    if (!focusCoaching) scrolledToCoaching.current = false;
    else scrollToCoaching();
  }, [focusCoaching, scrollToCoaching]);
  const [refreshing, setRefreshing] = useState(false);
  const generation = useRef(0);
  // 대본 탭에서 처음 한 번만 — 홈 가이드와 따로 센다 (SOMA-550).
  const [guideOpen, setGuideOpen] = useState(false);
  // 안내는 앱 맨 바깥에 그려져 다른 화면 위에도 덮인다 — 이 탭이 보일 때만 연다.
  const guideFocused = useRef(false);
  const newTarget = useSpotlightTarget(TARGET.readingNew);

  // 첫 사용자는 고르기 화면(「대사를 같이 맞춰 읽어 볼까요?」)이 안내를 대신한다 — 예전 「대본을 넣어 보세요」를 겹쳐 띄우지 않는다.
  const firstTimeRef = useRef(firstTime);
  firstTimeRef.current = firstTime;
  // 대본을 이미 올린 계정(앱을 다시 깐 기존 사용자, 첫 리딩을 마친 사람)에게는 「대본을 넣어 보세요」를 띄우지 않고 본 것으로 남긴다(10/26).
  const listLoaded = list !== null;
  const hasScripts = !!list && skipsReadingTabGuide(Math.max(list.total_count, list.scripts.length));
  const listStateRef = useRef({ loaded: listLoaded, hasScripts });
  listStateRef.current = { loaded: listLoaded, hasScripts };
  // 목록을 받은 뒤에만 연다 — 받기 전에 열었다가 대본이 있어 닫으면 안내가 잠깐 떴다 사라졌다(첫 리딩 뒤 리딩 탭, 11/2 폰 QA).
  const openReadingGuideIfNew = useCallback(() => {
    const { loaded, hasScripts: scripts } = listStateRef.current;
    if (!loaded) return;
    void hasSeenSpotlight('reading').then((seen) => {
      if (seen) return;
      if (scripts) {
        void markSpotlightSeen('reading');
        return;
      }
      if (guideFocused.current && !firstTimeRef.current) setGuideOpen(true);
    });
  }, []);
  useEffect(() => {
    if (listLoaded) openReadingGuideIfNew();
  }, [listLoaded, hasScripts, openReadingGuideIfNew]);
  useEffect(() => {
    if (!guideOpen || !hasScripts) return;
    setGuideOpen(false);
    void markSpotlightSeen('reading');
  }, [guideOpen, hasScripts]);

  const load = useCallback(async (keyword: string) => {
    const mine = ++generation.current;
    setError(null);
    try {
      const next = await listScripts(keyword);
      if (mine === generation.current) setList(next);
      const sceneTakes = await loadSceneTakes(currentFirstUseOwner());
      if (mine === generation.current) setTakes(sceneTakes);
      // 검색 중이 아닐 때만 「다음 할 일」 대본을 고른다 — 마지막으로 다룬 대본(리딩·촬영·코칭 중 가장 늦게 한 것). 없으면 카드 없이 목록만 보인다.
      const candidate = keyword.trim() ? null : lastHandledScript(next.scripts, sceneTakes);
      if (!candidate) {
        if (!keyword.trim() && mine === generation.current) setResume(null);
      } else {
        const step = practiceStepOf(candidate, sceneTakes[candidate.id]) as PracticeStep;
        // 리딩 중이면 이어 읽을 회차가 있어야 카드를 그린다. 리딩 끝이면 끝낸 회차 수를 알약에 적는다.
        const cardOf = (sessions: readonly SessionCard[]): NextCard | null => {
          const session = step === 'reading' ? resumeSessionOf(sessions) : null;
          if (step === 'reading' && !session) return null;
          return { script: candidate, step, session, readCount: sessions.filter((s) => s.status === 'completed').length };
        };
        // 그 대본의 회차를 받아 둔 게 있으면 먼저 카드를 그리고, 새로 받은 답으로 맞춘다.
        const known = lastRead<{ sessions: SessionCard[] }>(`readingSessions:${candidate.id}`)?.sessions;
        const knownCard = known ? cardOf(known) : null;
        if (knownCard && mine === generation.current) setResume(knownCard);
        const card = cardOf(await listSessions(candidate.id).catch(() => known ?? []));
        if (mine === generation.current) setResume(card);
      }
    } catch (e) {
      if (mine === generation.current) setError(scriptErrorMessage(e));
    }
  }, [setResume]);

  // 맨 위에서 당기면 지금 검색어로 목록을 다시 받는다 — 나누기가 끝났는지 탭을 나갔다 오지 않고 본다(SOMA-964).
  // load 는 실패를 안에서 잡아 오류 줄로 보이므로, 성공·실패 모두 끝나면 표시를 끈다.
  const refresh = async () => {
    setRefreshing(true);
    await load(q);
    setRefreshing(false);
  };

  const splitJobs = useSplitJobs(() => load(q));

  useFocusEffect(
    useCallback(() => {
      guideFocused.current = true;
      void load(q);
      // 설정의 동의 목록에서 고품질 목소리 동의를 바꿨을 수 있다 — 스위치를 다시 맞춘다.
      void refreshVoice().catch(() => undefined);
      // 올 때마다 묻는다 — 설정에서 되살린 뒤 앱을 다시 켜야 보이면 아무도 못 본다.
      void hasSeenReadingTutorial().then((seen) => {
        // 예전 「대본 리딩 한 바퀴」 시트는 새 디자인에서 대본 탭 입구가 대신한다(SOMA-748).
        if (!seen) void markReadingTutorialSeen();
        openReadingGuideIfNew();
      });
      return () => {
        generation.current += 1;
        // 떠나면 닫는다 — 설정에 다녀오면 다시 묻고 연다.
        guideFocused.current = false;
        setGuideOpen(false);
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [load]),
  );

  // 검색어는 잠깐 기다렸다가 서버에 묻는다(제목·배역 이름만). 처음 그릴 때는 포커스 로드가 맡는다.
  const searchedOnce = useRef(false);
  useEffect(() => {
    if (!searchedOnce.current) {
      searchedOnce.current = true;
      return;
    }
    const timer = setTimeout(() => void load(q), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [q, load]);

  const open = async (s: ScriptCard) => {
    const opened = await loadIntoCurrent(s.id);
    if (!opened) {
      void load(q);
      return;
    }
    router.push('/reading/detail');
  };
  const remove = async (s: ScriptCard) => {
    const ok = await confirm({
      title: t('reading.deleteTitle'),
      message: t('reading.deleteBody'),
      confirmLabel: t('common.delete'),
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteScript(s.id);
    } catch (e) {
      void alert({ title: t('reading.deleteFailTitle'), message: scriptErrorMessage(e) });
    }
    void load(q);
  };
  const more = (s: ScriptCard, e?: GestureResponderEvent) =>
    void sheet({
      anchor: pt(e),
      title: s.title,
      actions: [
        { label: t('reading.editAction'), icon: 'edit-2', onPress: () => setEditing(s) },
        { label: t('reading.deleteAction'), icon: 'trash-2', destructive: true, onPress: () => void remove(s) },
      ],
    });

  const scripts = list?.scripts ?? [];
  const searching = q.trim().length > 0;
  const empty = !!list && scripts.length === 0 && !searching;
  // 목록을 받기 전에는 「내 대본」 화면을 그리지 않는다 — 대본이 없는 첫 사용자에게 그 화면이 먼저 보였다가 입구로 바뀌었다(SOMA-932).
  const listPending = list === null && !error;
  // 받기 전 화면은 이 기기에서 지난번에 실제로 그린 모양(lib/skeleton-hint)을 따른다.
  // - 입구 카드 화면이었으면(또는 이 탭 기억은 없지만 홈이 첫 사용자로 확인했으면) 실제 입구 화면을 바로 그린다. 고정 화면이라 받을 것이 없다.
  // - 대본 목록이었으면 같은 틀에 줄만 회색인 뼈대를 그린다.
  // - 아무 기억도 없을 때만 입구 모양 회색 뼈대다.
  const skeletonHints = useSkeletonHints();
  const entryHint = skeletonHints.reading === 'empty' || (!skeletonHints.reading && firstTime);
  const showEntry = empty || (listPending && entryHint);
  const listSkeleton = listPending && skeletonHints.reading === 'list';
  const entrySkeleton = listPending && !listSkeleton && !entryHint;
  useEffect(() => {
    if (!list || q.trim()) return;
    const count = list.scripts.length;
    rememberSkeletonHints(count > 0 ? { reading: 'list', readingRows: Math.min(6, count) } : { reading: 'empty' });
  }, [list, q]);

  const goEntry = (choice: EntryKey) => {
    // 「내 대본 올리기」는 같은 고르기(파일·붙여넣기·만들기)를 한 번 더 보이지 않고 바로 파일 고르기 창을 연다(10/29).
    if (choice === 'upload') router.push({ pathname: '/reading/new', params: { pick: 'file' } });
    else if (choice === 'sample') router.push('/reading/sample');
    else if (choice === 'make') router.push({ pathname: '/script-cocreate', params: { mode: 'reading' } });
  };

  /** 진행 중 회차로 이어 읽는다. 회차를 모르면(줄에서 누름) 받아 둔 회차 → 서버 순으로 찾고, 없으면 대본 상세를 연다. */
  const continueReading = async (script: ScriptCard, known: SessionCard | null) => {
    if (resuming) return;
    setResuming(true);
    try {
      const cached = lastRead<{ sessions: SessionCard[] }>(`readingSessions:${script.id}`)?.sessions;
      const session = known ?? resumeSessionOf(cached ?? (await listSessions(script.id).catch(() => [])));
      if (!session) {
        await open(script);
        return;
      }
      const where = await openResume(script.id, session.id);
      if (where !== 'play') {
        void load(q);
        return;
      }
      router.push('/reading/play');
    } finally {
      setResuming(false);
    }
  };

  /** 대본의 「다음 할 일」 — 이어서 읽기 / 이 장면 찍기 / 코칭 받기(찍은 영상으로) / 다시 읽기(대본 상세). */
  const runNext = async (script: ScriptCard, step: PracticeStep, from: 'card' | 'row', session: SessionCard | null = null) => {
    logEvent('practice_next_tap', { action: ACTION_OF[step] });
    if (step === 'reading') return continueReading(script, session);
    if (step === 'coached') return open(script);
    if (step === 'shot') {
      return startSceneCoaching(router, currentFirstUseOwner(), { id: script.id, title: script.title, roles: script.my_character_names }, takes[script.id]);
    }
    if ((await sceneStart.start(script, from)) === 'failed') {
      void alert({ title: t('coachScripts.sceneOpenFail'), message: t('settings.retryLater') });
    }
  };

  const tapStep = (step: PracticeStepKey) => {
    logEvent('practice_step_tap', { step });
    if (step === 'read') router.push('/reading/new');
    else if (step === 'shoot') router.push({ pathname: '/coach-scripts', params: { purpose: 'scene' } });
    // 코칭을 한 번도 안 했으면 목적을 묻지 않는 첫 코칭(SOMA-984), 아니면 새 연습 준비.
    else if (!groups || coachingEntry(groups).kind === 'first') router.push({ pathname: '/upload', params: { first: '1' } });
    else router.push('/upload');
  };

  // 카드의 코치 메모 한 줄 — 그 대본으로 받은 코칭 묶음의 마지막 노트 「다음엔 …」. 못 찾으면 줄을 생략한다.
  const memoGroup = resume?.step === 'coached' && groups ? coachGroupFor(takes[resume.script.id], resume.script.title, groups, sceneTitle) : null;
  const memoPracticeId = memoGroup ? lastNotePracticeId(memoGroup) : null;
  const memoTakes = useNextTakes([memoPracticeId]);
  const memo = memoPracticeId ? (memoTakes[memoPracticeId] ?? null) : null;
  const cardBusy = resuming || (!!resume && sceneStart.opening === resume.script.id);

  const voiceBar = (
    cloudVoice.status?.available ? (
      <View style={styles.voiceBar}>
        <MaterialCommunityIcons name="waveform" size={18} color={palette.blue} />
        <Text style={styles.voiceText} numberOfLines={2}>
          {t('cloudVoice.bannerLabel')}
        </Text>
        {!!voiceFreeUntil && <Text style={styles.voiceBadgeText}>{t('cloudVoice.bannerFree', { date: voiceFreeUntil })}</Text>}
        <BlueSwitch
          value={cloudVoice.enabled && cloudVoice.status.consent === 'granted'}
          onValueChange={(value) => void (value ? cloudVoice.enable('settings') : cloudVoice.disable())}
          disabled={cloudVoice.busy}
          accessibilityLabel={t('cloudVoice.bannerLabel')}
        />
      </View>
    ) : null
  );

  return (
    <View style={styles.root}>
      <ScrollView
      ref={scrollRef}
      // 입구 위 띠의 첫 색은 위 여백(당기기 표시 자리)까지 스크롤 배경으로 칠한다 — 내용 안에 두면 당기기 표시를 덮는다.
      style={[styles.root, (showEntry || entrySkeleton) && styles.rootEmpty]}
      contentContainerStyle={[styles.content, { paddingTop: insets.top - iosTopInset, paddingBottom: tabBarSpace + 20 }]}
      contentInset={{ top: iosTopInset }}
      contentOffset={{ x: 0, y: -iosTopInset }}
      automaticallyAdjustContentInsets={false}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={palette.blue} />}>
      {(showEntry || entrySkeleton) && (
        <BandGradient
          stops={[[0, ENTRY_TOP], [1, palette.bg]]}
          style={{ top: insets.top - iosTopInset, bottom: undefined, height: ENTRY_FADE_END - insets.top }}
        />
      )}
      {/* NavHeader/Large — 탭 머리 큰 제목 「연습」. */}
      <View style={styles.headWrap}>
        <NavHeader
          large
          title={t('practiceTab.title')}
          right={
            <View style={styles.headRight}>
              {/* 첫 사용자에게는 설정(로그아웃·탈퇴) 길을 머리에도 둔다(SOMA-781). */}
              {firstTime && (
                <NavIconButton icon="settings" size={24} label={t('settings.title')} phLabel="reading_first_settings" onPress={() => router.push('/settings')} />
              )}
            </View>
          }
        />
      </View>

      {/* 단계 칸 셋 — 고정 칸이라 받기 전에도 그대로 그린다. */}
      <PracticeSteps onPress={tapStep} />

      {/* 고품질 목소리 띠 — 대본이 있어도 머리 아래에 둔다(10/25 사용자 결정, 기본 켜짐). */}
      {!showEntry && !entrySkeleton && voiceBar}

      {error && <InlineError message={t('reading.listLoadFail')} onRetry={() => void load(q)} />}

      {listPending && !showEntry ? (
        listSkeleton ? <ReadingListSkeleton rows={skeletonHints.readingRows ?? 4} /> : <ReadingEntrySkeleton voiceBar={voiceBar} />
      ) : showEntry ? (
        // pen R1.13 — 큰 「리딩」 제목과 책 위 액티, 고품질 목소리 알약, 그라데이션 입구 카드 셋(누르면 바로 들어감).
        <View style={styles.entry}>
          <View style={styles.hero}>
            <View style={styles.heroText}>
              <Text style={styles.heroTitle} accessibilityRole="header">{t('reading.tabTitle')}</Text>
              <Text style={styles.heroSub}>{t('reading.entryHeroSub')}</Text>
            </View>
            <Image source={HERO_ACTY} style={styles.heroActy} resizeMode="stretch" accessibilityElementsHidden />
          </View>
          {voiceBar}
          <View style={styles.entryCards}>
            {splitJobs.rows.map((job) => (
              <SplitJobRow key={job.importId} job={job} card onDismiss={splitJobs.dismiss} />
            ))}
            {ENTRY_CHOICES.map((c) => (
              <Pressable
                key={c.key}
                ref={c.key === 'upload' ? newTarget.ref : undefined}
                onLayout={c.key === 'upload' ? newTarget.onLayout : undefined}
                style={({ pressed }) => [styles.entryCard, c.primary ? styles.entryCardPrimary : styles.entryCardPlain, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={t(c.title)}
                ph-label={`reading_entry_${c.key}`}
                onPress={() => goEntry(c.key)}>
                <View style={styles.entryArt}>
                  {ENTRY_ART[c.key] != null ? (
                    <Image source={ENTRY_ART[c.key]} style={styles.entryArtImg} resizeMode="contain" accessibilityElementsHidden />
                  ) : (
                    <View style={styles.entryTile}>
                      <MaterialCommunityIcons name="auto-fix" size={26} color={palette.onAccent} />
                    </View>
                  )}
                </View>
                <View style={styles.entryBody}>
                  <Text style={[styles.entryTitle, c.primary && styles.onAccent]}>{t(c.title)}</Text>
                  <Text style={[styles.entrySub, c.primary && styles.onMediaSub]}>{t(c.sub)}</Text>
                </View>
                <View style={[styles.entryGo, !c.primary && styles.entryGoPlain]}>
                  <Feather name="chevron-right" size={18} color={palette.blue} />
                </View>
              </Pressable>
            ))}
          </View>
        </View>
      ) : (
        <>
          {resume && !searching && (() => {
            const scriptRole = t('practiceTab.scriptRole', { title: resume.script.title, roles: myCharactersLabel(resume.script) });
            const card = nextCardCopy(resume, scriptRole, memo);
            return (
              // 카드 전체를 누른다 — 카드 안에 따로 버튼을 두지 않는다(UX 가이드 5절, 10/23).
              <Pressable
                style={({ pressed }) => [styles.resumeCard, pressed && styles.pressed]}
                onPress={() => void runNext(resume.script, resume.step, 'card', resume.session)}
                disabled={cardBusy}
                accessibilityRole="button"
                accessibilityState={{ busy: cardBusy, disabled: cardBusy }}
                accessibilityLabel={cardBusy ? t('loadingText.preparing') : card.go}
                accessibilityHint={resume.script.title}
                ph-label="reading_resume_card"
                testID={`practice-next-${resume.step}`}>
                {/* 10/29 시안 — 진한 파랑 카드, 위 흰 반투명 알약, 오른쪽 아래 책 위의 액티, 아래 흰 알약 [다음 할 일 →]. 글·버튼만 단계에 맞게 바뀐다. */}
                <Image source={HERO_ACTY} style={styles.resumeActy} resizeMode="contain" accessibilityElementsHidden />
                <View style={styles.resumeChip}>
                  <Text style={styles.resumeEyebrow}>{card.chip}</Text>
                </View>
                <Text style={styles.resumeTitle}>{card.title}</Text>
                {card.hint ? <Text style={styles.resumeHint} numberOfLines={3}>{card.hint}</Text> : null}
                <View style={styles.resumeBtn}>
                  <Text style={styles.resumeBtnText}>{cardBusy ? t('loadingText.preparing') : card.go}</Text>
                  {!cardBusy && <Feather name="arrow-right" size={18} color={heroCard.ctaBlue} />}
                </View>
              </Pressable>
            );
          })()}

          {/* 이어 하기 → 새 대본 → 지난 기록(업로드한 대본) 순서(SOMA-1123). 이어 읽을 회차가 없으면 새 대본이 맨 위다. */}
          {!searching && (
            <View testID="reading-new-entry">
              <Button
                variant="secondary"
                size="md"
                label={t('reading.titleNew')}
                icon={<Feather name="plus" size={18} color={palette.blue} />}
                phLabel="reading_new"
                onPress={() => router.push('/reading/new')}
              />
            </View>
          )}

          <AdSlot slot="reading_tab_top" />

          {list && (
            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>{t('reading.uploadedTitle')}</Text>
              <Text style={styles.sectionCount}>{t('reading.uploadedCount', { count: list.total_count })}</Text>
            </View>
          )}
          {/* pen R1.3·R1.4 — 검색칸은 「업로드한 대본」 머리 아래, 목록 바로 위에 둔다. */}
          <View style={styles.search}>
            <Feather name="search" size={18} color={palette.iconFaint} />
            <TextInput
              style={styles.searchInput}
              value={q}
              onChangeText={(text) => setQ(sanitizeInput(text, 'loose'))}
              placeholder={t('reading.searchPlaceholder')}
              placeholderTextColor={palette.textMeta}
            />
          </View>
          <View style={styles.list}>
            {[
              ...(searching ? [] : splitJobs.rows.map((job) => <SplitJobRow key={`job-${job.importId}`} job={job} onDismiss={splitJobs.dismiss} />)),
              ...scripts.map((s) => {
                // 줄 아래 상태 한 줄과 오른쪽 「다음 할 일」 글자 버튼 — 배역을 고른 적도 찍은 적도 없는 새 대본은 둘 다 없다.
                const step = practiceStepOf(s, takes[s.id]);
                const status = step
                  ? step === 'coached' && memo && resume?.script.id === s.id
                    ? t('practiceTab.memo', { text: memo })
                    : rowStatus(s, step)
                  : null;
                const busy = sceneStart.opening === s.id;
                return (
                  <Pressable
                    key={s.id}
                    style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                    onPress={() => void open(s)}
                    onLongPress={(e) => more(s, e)}>
                    <View style={styles.rowIcon}>
                      <Feather name="file-text" size={20} color={palette.blue} />
                    </View>
                    <View style={styles.rowBody}>
                      <Text style={styles.rowTitle} numberOfLines={1}>{s.title}</Text>
                      <Text style={styles.rowMeta} numberOfLines={1}>
                        {myCharactersLabel(s)} · {t('reading.dialogueCount', { count: s.dialogue_count })}
                      </Text>
                      {status ? (
                        <Text style={styles.rowStatus} numberOfLines={1} testID={`practice-row-status-${s.id}`}>
                          {status}
                        </Text>
                      ) : null}
                    </View>
                    {step ? (
                      <Pressable
                        style={({ pressed }) => [styles.rowGo, pressed && styles.pressed]}
                        hitSlop={8}
                        disabled={busy || resuming}
                        accessibilityRole="button"
                        accessibilityLabel={busy ? t('loadingText.preparing') : t(ROW_GO[step])}
                        accessibilityHint={s.title}
                        ph-label={`practice_row_${ACTION_OF[step]}`}
                        onPress={() => void runNext(s, step, 'row')}>
                        <Text style={styles.rowGoText}>{busy ? t('loadingText.preparing') : t(ROW_GO[step])}</Text>
                      </Pressable>
                    ) : null}
                    <Pressable style={styles.moreBtn} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('reading.more')} ph-label="reading_script_more" onPress={(e) => more(s, e)}>
                      <Feather name="more-horizontal" size={18} color={palette.iconFaint} />
                    </Pressable>
                  </Pressable>
                );
              }),
            ].map((row, i) => (
              <Fragment key={row.key}>
                {i > 0 && <View style={styles.rowDivider} />}
                {row}
              </Fragment>
            ))}
            {scripts.length === 0 && searching && <InlineEmpty title={t('reading.noMatch')} description={t('reading.noMatchSub')} />}
          </View>
        </>
      )}
      {/* 코칭 구역 — 내 대본 아래(검색 중에는 숨긴다). 주소가 mode=coaching 이면 여기로 한 번 내려 준다. */}
      {!searching && (
        <View
          onLayout={(e) => {
            coachingY.current = e.nativeEvent.layout.y;
            scrollToCoaching();
          }}>
          <CoachingSection
            groups={groups}
            failed={groupsFailed}
            onRetry={() => {
              setGroupsFailed(false);
              setGroupsAttempt((n) => n + 1);
            }}
          />
        </View>
      )}
      {dialog}
      {cloudVoice.consentSheet}
      <TitleEditDialog
        script={editing}
        onClose={(saved) => {
          setEditing(null);
          if (saved) void load(q);
        }}
      />

      {/* 가이드는 제 창에 뜬다 — 목록 어디에 두든 자리를 차지하지 않는다. */}
      <SpotlightGuide
        visible={guideOpen && !!list && !hasScripts}
        topic="reading"
        steps={READING_STEPS}
        onDone={() => {
          setGuideOpen(false);
          void markSpotlightSeen('reading');
        }}
      />
      </ScrollView>
      {/* 내리면 내용이 상태 표시줄 밑으로 비쳐 겹쳐 보였다(11/2 QA) — 상태 표시줄 자리를 바탕색으로 덮는다. */}
      <View pointerEvents="none" style={[styles.statusCover, { height: insets.top }, (showEntry || entrySkeleton) && styles.statusCoverEmpty]} />
    </View>
  );
}

/** 「다음 할 일」 카드의 알약·제목·보조 줄·버튼 글 — 리딩 중은 예전 「이어서 읽기」 카드 그대로다. */
function nextCardCopy(card: NextCard, scriptRole: string, memo: string | null): { chip: string; title: string; hint: string | null; go: string } {
  switch (card.step) {
    case 'reading':
      return {
        chip: t('practiceTab.chipReading'),
        title: t('reading.resumeHeadline', {
          title: card.script.title,
          roles: myCharactersLabel(card.script),
          done: card.session?.progress?.done ?? 0,
          total: card.session?.progress?.total ?? 0,
        }),
        hint: t('reading.resumeHint'),
        go: t('reading.resumeGo'),
      };
    case 'read':
      return {
        chip: card.readCount > 0 ? t('practiceTab.chipRead', { count: card.readCount }) : t('practiceTab.chipReadDone'),
        title: t('practiceTab.headRead'),
        hint: scriptRole,
        go: t('practiceTab.goShoot'),
      };
    case 'shot':
      return { chip: t('practiceTab.chipShot'), title: t('practiceTab.headShot'), hint: scriptRole, go: t('practiceTab.goCoach') };
    case 'coached':
      return {
        chip: t('practiceTab.chipCoached'),
        title: scriptRole,
        hint: memo ? t('practiceTab.memo', { text: memo }) : null,
        go: t(memo ? 'practiceTab.goAgainMemo' : 'practiceTab.goAgain'),
      };
  }
}

/** 대본 줄 아래 상태 한 줄. 회차 진행·끝낸 회차 수는 이 기기가 받아 둔 회차가 있을 때만 적는다. */
function rowStatus(script: ScriptCard, step: PracticeStep): string {
  const sessions = lastRead<{ sessions: SessionCard[] }>(`readingSessions:${script.id}`)?.sessions;
  if (step === 'reading') {
    const progress = sessions ? resumeSessionOf(sessions)?.progress : null;
    return progress ? t('practiceTab.rowReadingProgress', { done: progress.done, total: progress.total }) : t('practiceTab.rowReading');
  }
  if (step === 'read') {
    const count = sessions?.filter((s) => s.status === 'completed').length ?? 0;
    return count > 0 ? t('practiceTab.rowRead', { count }) : t('practiceTab.rowReadDone');
  }
  return t(step === 'shot' ? 'practiceTab.rowShot' : 'practiceTab.rowCoached');
}

/** 대본이 없을 때 화면(입구 카드 셋)의 뼈대 — 큰 「리딩」 제목과 액티는 고정이라 그대로, 카드는 같은 틀에 글만 회색. */
function ReadingEntrySkeleton({ voiceBar }: { voiceBar: ReactNode }) {
  return (
    <SkeletonGroup style={styles.entry}>
      <View style={styles.hero}>
        <View style={styles.heroText}>
          <Text style={styles.heroTitle}>{t('reading.tabTitle')}</Text>
          <Text style={styles.heroSub}>{t('reading.entryHeroSub')}</Text>
        </View>
        <Image source={HERO_ACTY} style={styles.heroActy} resizeMode="stretch" accessibilityElementsHidden />
      </View>
      {voiceBar}
      <View style={styles.entryCards}>
        {ENTRY_CHOICES.map((c) => (
          <View key={c.key} style={[styles.entryCard, styles.entryCardPlain]}>
            <View style={styles.entryArt}>
              <SkeletonBlock width={52} height={52} radius={radius.md} />
            </View>
            <View style={styles.entryBody}>
              <SkeletonLine size={type.body1Bold} width="56%" />
              <SkeletonLine size={type.caption} width="82%" />
              {c.key === 'make' && <SkeletonLine size={type.caption} width="30%" />}
            </View>
            <SkeletonBlock width={32} height={32} radius={radius.full} />
          </View>
        ))}
      </View>
    </SkeletonGroup>
  );
}

/** 대본 목록 화면의 뼈대 — 「업로드한 대본」 머리와 검색 칸은 실제와 같고, 줄 수는 지난번 대본 수(최대 6)를 따른다. */
function ReadingListSkeleton({ rows }: { rows: number }) {
  return (
    // 실제 목록은 화면 content 의 gap 으로 머리·검색·목록 사이를 띄운다. 뼈대는 한 묶음이라 같은 gap 을 직접 준다.
    <SkeletonGroup style={styles.listSkeleton}>
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>{t('reading.uploadedTitle')}</Text>
        <SkeletonLine size={type.caption} width={44} />
      </View>
      <View style={styles.search}>
        <Feather name="search" size={18} color={palette.iconFaint} />
        <Text style={[styles.searchInput, { color: palette.textMeta }]} numberOfLines={1}>
          {t('reading.searchPlaceholder')}
        </Text>
      </View>
      <View style={styles.list}>
        {Array.from({ length: rows }, (_, i) => (
          <Fragment key={i}>
            {i > 0 && <View style={styles.rowDivider} />}
            <View style={styles.row}>
              <View style={styles.rowIcon}>
                <SkeletonBlock width={18} height={20} radius={4} />
              </View>
              <View style={styles.rowBody}>
                <SkeletonLine size={type.body1Bold} width={i % 2 === 0 ? '44%' : '36%'} />
                <SkeletonLine size={type.caption} width={i % 2 === 0 ? '58%' : '50%'} />
              </View>
            </View>
          </Fragment>
        ))}
      </View>
    </SkeletonGroup>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.bg },
  rootEmpty: { backgroundColor: ENTRY_TOP },
  statusCover: { position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: palette.bg },
  statusCoverEmpty: { backgroundColor: ENTRY_TOP },
  content: { flexGrow: 1, backgroundColor: palette.bg, paddingHorizontal: space.gutter, gap: space[3] },
  listSkeleton: { gap: space[3] },
  headWrap: { marginHorizontal: -space.gutter },
  headRight: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  voiceBar: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    backgroundColor: palette.bg,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radius.full,
    paddingLeft: space[3],
    paddingRight: space[1],
  },
  voiceText: { ...type.captionBold, flex: 1, color: palette.text },
  voiceBadgeText: { ...type.micro, color: palette.blueDeep },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    backgroundColor: palette.bg,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radius.md,
    paddingHorizontal: space[4],
    height: 48,
  },
  searchInput: { ...type.body1, lineHeight: undefined, flex: 1, color: palette.text, padding: 0 },
  entry: { gap: space[4] },
  hero: { height: 188, flexDirection: 'row', alignItems: 'center' },
  heroText: { flex: 1, gap: space[3] },
  heroTitle: { ...type.display, color: palette.text },
  heroSub: { ...type.body2, color: palette.textSub },
  heroActy: { width: 170, height: 188 },
  entryCards: { gap: space[3], paddingTop: space[2] },
  entryCard: { minHeight: 108, borderRadius: radius.lg, flexDirection: 'row', alignItems: 'center', gap: space[3], padding: space[4] },
  entryCardPrimary: { backgroundColor: palette.blue },
  entryCardPlain: { backgroundColor: palette.bg, borderWidth: 1, borderColor: palette.border },
  entryArt: { width: 68, height: 76, alignItems: 'center', justifyContent: 'center' },
  entryArtImg: { width: 68, height: 76 },
  entryTile: { width: 52, height: 52, borderRadius: radius.md, backgroundColor: palette.blue, alignItems: 'center', justifyContent: 'center' },
  entryBody: { flex: 1, gap: space[1] },
  entryTitle: { ...type.body1Bold, color: palette.text },
  entrySub: { ...type.caption, color: palette.textMeta },
  onAccent: { color: palette.onAccent },
  onMediaSub: { color: palette.onMediaSub },
  entryGo: { width: 32, height: 32, borderRadius: radius.full, backgroundColor: palette.bg, alignItems: 'center', justifyContent: 'center' },
  entryGoPlain: { borderWidth: 1, borderColor: palette.border },
  resumeCard: { backgroundColor: heroCard.bg, borderRadius: radius.xl, padding: space[5], gap: space[2], overflow: 'hidden' },
  resumeActy: { position: 'absolute', right: -space[2], bottom: -space[1], width: 150, height: 160 },
  resumeChip: { alignSelf: 'flex-start', backgroundColor: heroCard.chipLight, borderRadius: radius.full, paddingHorizontal: space[3], paddingVertical: space[1] },
  resumeEyebrow: { ...type.captionBold, color: palette.onAccent },
  resumeTitle: { ...type.title2, color: palette.onAccent, maxWidth: '70%', marginTop: space[1] },
  resumeHint: { ...type.body2, color: palette.onMediaSub, maxWidth: '58%' },
  resumeBtn: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    marginTop: space[3],
    height: 48,
    paddingHorizontal: space[6],
    borderRadius: radius.full,
    backgroundColor: palette.bg,
  },
  resumeBtnText: { ...type.body1Bold, color: heroCard.ctaBlue },
  pressed: { opacity: 0.85 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space[2] },
  sectionTitle: { ...type.headline, color: palette.text },
  sectionCount: { ...type.caption, color: palette.textMeta },
  list: { gap: 0 },
  row: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: space[3] },
  rowDivider: { height: 1, marginLeft: ROW_ICON_WIDTH + space[3], backgroundColor: palette.border },
  rowIcon: { width: ROW_ICON_WIDTH, alignItems: 'center' },
  rowBody: { flex: 1, minWidth: 0, gap: space[1] },
  rowTitle: { ...type.body1Bold, color: palette.text },
  rowMeta: { ...type.caption, color: palette.textMeta },
  rowStatus: { ...type.captionBold, color: palette.blueDeep },
  // Button/Text — 줄 오른쪽 「다음 할 일」 글자 버튼(알약 바탕 없음).
  rowGo: { height: 32, paddingHorizontal: space[1], alignItems: 'center', justifyContent: 'center' },
  rowGoText: { ...type.body2Bold, color: palette.blueDeep },
  moreBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
});
