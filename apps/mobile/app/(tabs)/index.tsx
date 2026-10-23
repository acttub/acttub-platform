import Feather from '@expo/vector-icons/Feather';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps, type Ref } from 'react';
import { ActivityIndicator, BackHandler, Platform, Pressable, ScrollView, StyleSheet, Text, ToastAndroid, View, type LayoutChangeEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/ui/buttons';
import { useTabBarSpace } from '@/components/ui/tab-bar';
import { MASCOT } from '@/components/ui/mascot';
import { MascotBubble } from '@/components/ui/mascot-bubble';
import { palette } from '@/constants/palette';
import { api } from '@/lib/api';
import { buildWeekActivity } from '@/lib/practice-activity';
import { practiceStreak, sceneTitle } from '@/lib/practice/groups';
import type { PracticeGroup } from '@/lib/practice/types';
import { continueActionFor } from '@/lib/practice/resume';
import { setContinueOrigin } from '@/lib/practice/session-state';
import { rememberPracticeDays } from '@/lib/practice-days';
import { countedPractices, type CountedPractice } from '@/lib/practice/counted';
import { hasSeenSpotlight, hasSeenTutorial, markSpotlightSeen, markTutorialSeen } from '@/lib/guide-state';
import { currentTutorial } from '@/lib/tutorial';
import { kstDate, urgentAuditions, type AuditionPostingList } from '@/lib/auditions';
import { isKorean, translate as t, translateList } from '@/lib/i18n';
import { firstTimeStateFrom, setFirstTimeState } from '@/lib/practice/first-time';
import { challengeDaysLeft, pickToday, primaryFeature, wasYesterday, type TodayItem } from '@/lib/home-today';
import type { ScriptCard, SessionProgress } from '@/lib/reading/types';
import type { ChallengeCard } from '@/lib/challenge/types';
import { loadIntoCurrent } from '@/lib/reading/store';
import { DEFAULT_SEC_PER_LINE, displayProgress, hasReachedEnd, remainingMinutes, secPerLine } from '@/lib/reading/progress-display';
import { SpotlightGuide, type SpotlightStep } from '@/components/spotlight-guide';
import { finishTutorial } from '@/hooks/use-tutorial-spotlight';
import { StreakCelebrationScreen } from '@/components/streak-celebration-screen';
import { AnnouncementPoster } from '@/components/announcement-poster';
import { HomeUploadCard } from '@/components/home-upload-card';
import { useWaitingUpload } from '@/hooks/use-waiting-upload';
import { useAuth } from '@/lib/auth';
import { homeDeadlineSections } from '@/lib/home-sections';
import { useNextTakes } from '@/hooks/use-next-takes';
import { useSpotlightTarget } from '@/hooks/use-spotlight-target';
import { useUnreadNotifications } from '@/hooks/use-unread-notifications';
import { TARGET } from '@/lib/spotlight-targets';
import {
  readLastSeenStreak,
  celebrationDots,
  streakCelebrationStep,
  writeLastSeenStreak,
} from '@/lib/streak-celebration';

/** 첫 사용자 홈에서 고른 길 → 「계속하기」가 가는 탭(예전엔 카드를 누르면 바로 갔다). */
type FirstPick = 'coaching' | 'reading' | 'challenge';
const FIRST_PICK_ROUTE: Record<FirstPick, '/coaching' | '/reading' | '/challenges'> = {
  coaching: '/coaching',
  reading: '/reading',
  challenge: '/challenges',
};

/** 히어로 바탕 — 연한 파랑에서 화면 바탕색으로 서서히 옅어지는 띠(그라데이션 모듈이 없어 단색 띠를 겹친다). */
const HERO_FADE = ['#E4EEFC', '#E6EFFC', '#E9F1FD', '#ECF3FD', '#EFF5FD', '#F2F7FE', '#F5F9FE', '#F7FAFE'];

/** 추천 연습 카드 바탕(pen #202121). */
const DARK_CARD = '#202121';

/** 안드로이드 뒤로가기를 이 시간 안에 한 번 더 누르면 앱을 닫는다. */
const EXIT_BACK_WINDOW_MS = 2000;

/**
 * 첫 연습을 끝낸 뒤 홈에서 한 번 비추는 자리(pen 「첫 연습 끝 홈 · 안내 1/4~4/4」, SOMA-748) — 오늘 할 것 카드,
 * 그리고 대본·챌린지·프로필 탭. 첫 사용자 홈(뭐부터 해 볼까요?)에서는 띄우지 않는다.
 */
const HOME_STEPS: SpotlightStep[] = [
  { target: TARGET.homeStart, text: 'guide.spotFirstDone', mascot: 'home' },
  { target: TARGET.tabReading, text: 'guide.spotReadingTab', round: true, mascot: 'reading' },
  { target: TARGET.tabChallenge, text: 'guide.spotChallengeTab', round: true, mascot: 'coach' },
  { target: TARGET.tabProfile, text: 'guide.spotProfileTab', round: true, mascot: 'home' },
];

/** 홈이 리딩 회차를 읽을 대본 — 최근 14일 안에 연습한 것만(연속일·주간 원에 쓰는 만큼). */
const READING_LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;
function recentlyPracticedScripts(scripts: readonly ScriptCard[], now = Date.now()): ScriptCard[] {
  return scripts.filter((s) => {
    const at = Date.parse(s.last_practiced_at ?? '');
    return Number.isFinite(at) && now - at <= READING_LOOKBACK_MS;
  });
}

/**
 * A1. 홈(pen 일반 홈 BTT6at·SSeGm·gVzpd, 첫 사용자 홈 bHxn1I, SOMA-748).
 * 첫 연습 전이면 인사·소개 말풍선과 「뭐부터 해 볼까요?」 선택 카드(고르면 펼쳐지고 「계속하기」로 들어간다), 그 뒤로는 인사 + 오늘 할 것 카드 하나 + 하던 거 한 줄 +
 * 최근 연습·마감 임박(practice.library·app.audition) + 오늘의 연기 팁이다.
 * 디자인의 「업데이트 소식」 띠와 일정 D-day 줄은 서버 기능이 없어 그리지 않는다.
 */
export default function HomeScreen() {
  const router = useRouter();
  const { user, consentEntry, profile } = useAuth();
  const unread = useUnreadNotifications();
  // 재동의 팝업이 떠 있는 동안 홈의 첫 안내들을 띄우지 않는다. 둘 다 홈 위에 덮여 어느 쪽이 위에 올지 정해지지 않는다.
  // 팝업(Modal)이 닫히는 동안 다른 Modal을 띄우면 iOS가 띄우지 못해, 닫힘이 끝난 뒤에 연다
  // (iOS 시뮬레이터에서 400ms는 시트가 안 떴고 700ms는 떴다. 여유를 둔 값이다).
  const consentAllowed = consentEntry.status === 'allowed';
  const [overlaysReady, setOverlaysReady] = useState(consentAllowed);
  useEffect(() => {
    if (!consentAllowed) {
      setOverlaysReady(false);
      return;
    }
    const timer = setTimeout(() => setOverlaysReady(true), 800);
    return () => clearTimeout(timer);
  }, [consentAllowed]);
  const [groups, setGroups] = useState<PracticeGroup[]>([]);
  // 묶음을 한 번이라도 받아 봤는지(실패도 받은 셈) — 받기 전엔 첫 사용자 화면을 함부로 띄우지 않는다.
  const [groupsLoaded, setGroupsLoaded] = useState(false);
  const [groupsFailed, setGroupsFailed] = useState(false);
  const [scripts, setScripts] = useState<ScriptCard[] | null>(null);
  const [readingProgress, setReadingProgress] = useState<{ scriptId: string; progress: SessionProgress; perLine: number } | null>(null);
  const [featured, setFeatured] = useState<ChallengeCard | null>(null);
  // 연속일·주간 원용 날짜 — 서버 기록 ∪ 기기에 누적된 연습일(지워도 남는다).
  // null 이면 기록을 아직 한 번도 못 받은 것이다 — 그때의 연속일(0)로 축하를 판단하면 안 된다.
  const [activityDays, setActivityDays] = useState<{ created_at: string }[] | null>(null);
  // 주 기능 판단용 — 센 연습(코칭·리딩·챌린지) 목록.
  const [practices, setPractices] = useState<CountedPractice[]>([]);
  const [auditions, setAuditions] = useState<AuditionPostingList | null>(null);
  const [celebrateStreak, setCelebrateStreak] = useState<number | null>(null);
  // 처음 한 번만 가이드 — 누를 자리를 비춰 준다. 설정의 "가이드 다시 보기"로 되살릴 수 있다.
  const [guideOpen, setGuideOpen] = useState(false);
  // 안내는 앱 맨 바깥에 그려져 다른 화면 위에도 덮인다 — 홈이 보일 때만 연다.
  const guideFocused = useRef(false);
  // 홈 안내를 띄울지 확인을 마쳤는지, 그리고 이번 방문에 안내를 봤는지. 안내를 본 방문에는 공지 포스터(AI 목소리 홍보 등)·
  // 연속일 축하를 미룬다 — 안내 4단계가 끝나자마자 다른 팝업이 연달아 뜨지 않게(SOMA-771).
  const [guideChecked, setGuideChecked] = useState(false);
  const [guideShownThisVisit, setGuideShownThisVisit] = useState(false);
  const [introChecked, setIntroChecked] = useState(false);
  const [onboardingJustFinished, setOnboardingJustFinished] = useState(false);
  const startTarget = useSpotlightTarget(TARGET.homeStart);
  // 첫 사용자 홈에서 고른 카드 — 고르기 전엔 아래 버튼이 「하나를 골라 주세요」로 막혀 있다.
  const [firstPick, setFirstPick] = useState<FirstPick | null>(null);
  const tabBarSpace = useTabBarSpace();
  const firstName = profile.me?.profile?.name?.trim() ?? '';

  const openHomeGuideIfNew = useCallback(() => {
    void hasSeenSpotlight('home').then((seen) => {
      if (!seen && guideFocused.current) setGuideOpen(true);
      setGuideChecked(true);
    });
  }, []);

  useFocusEffect(
    useCallback(() => {
      // 올 때마다 본 적 있는지 묻는다(기기에서 읽는 값이라 싸다). 한 번만 묻고 말면,
      // 설정에서 되살린 뒤 앱을 껐다 켜야 보인다 — 실기기에서 그렇게 걸렸다.
      // 튜토리얼 중에 홈으로 돌아왔다면 루프를 벗어난 것이다 — 거기서 끝낸다.
      guideFocused.current = true;
      if (currentTutorial()) finishTutorial('left');
      setGuideShownThisVisit(false);
      void hasSeenTutorial().then((seen) => {
        setIntroChecked(true);
        // 예전 「연습 한 바퀴」 시트는 새 디자인에서 첫 사용자 홈(뭐부터 해 볼까요?)이 대신한다(SOMA-748).
        if (!seen) {
          void markTutorialSeen();
          setOnboardingJustFinished(true);
        }
        openHomeGuideIfNew();
      });
      let cancelled = false;
      const groupsRead = api
        .listPracticeGroups('all')
        .then((r) => {
          if (cancelled) return r.groups;
          setGroups(r.groups);
          setGroupsFailed(false);
          setGroupsLoaded(true);
          return r.groups;
        })
        .catch(() => {
          if (!cancelled) {
            setGroups([]);
            setGroupsFailed(true);
            setGroupsLoaded(true);
          }
          return [] as PracticeGroup[];
        });
      // 오늘 할 것의 리딩 후보 — 이어 읽을 대본. 실패하면 리딩 후보만 빠진다.
      const scriptsRead = Promise.resolve()
        .then(() => api.listReadingScripts())
        .then((r) => {
          if (!cancelled) setScripts(r.scripts);
          return r.scripts;
        })
        .catch(() => {
          if (!cancelled) setScripts([]);
          return [] as ScriptCard[];
        });
      // 연속일·주간 원·「첫 연습 끝!」은 「연습 1회」 기준 하나로 센다(SOMA-773) — 노트가 생긴 코칭 회차, 끝까지 읽은
      // 리딩 회차, 올린 참여작. 리딩 회차는 대본별로만 받으므로 최근에 연습한 대본만 읽는다(지난 날은 기기에 쌓여 있다).
      const readingRead = scriptsRead
        .then((list) => Promise.all(recentlyPracticedScripts(list).map((s) => api.listReadingSessions(s.id).then((x) => x.sessions).catch(() => []))))
        .then((lists) => lists.flat())
        .catch(() => []);
      const entriesRead = Promise.resolve()
        .then(() => api.listMyChallengeEntries())
        .then((r) => r.entries)
        .catch(() => []);
      void Promise.all([groupsRead, readingRead, entriesRead]).then(([groupList, readingSessions, entries]) => {
        // 화면을 떠난 뒤 온 응답은 버린다 — 기기에 쌓지도 않는다.
        if (cancelled) return;
        // 연습한 날은 기기에도 쌓아 둔다 — 기록을 숨겨도 "그 날 연습했다"는 사실은 남는다.
        const counted = countedPractices({ groups: groupList, readingSessions, entries });
        setPractices(counted);
        return rememberPracticeDays(counted.map((p) => ({ created_at: p.at }))).then((days) => {
          if (!cancelled) setActivityDays(days);
        });
      });
      return () => {
        cancelled = true;
        // 떠나면 닫는다 — 설정에 다녀오면 다시 묻고 연다.
        guideFocused.current = false;
        setGuideOpen(false);
      };
    }, [router, openHomeGuideIfNew]),
  );

  useEffect(() => {
    // 한국어를 안 쓰는 사람에겐 보여줄 자리가 없으니 받아오지도 않는다 (SOMA-544).
    if (!isKorean()) return;
    let cancelled = false;
    // 오디션 공고는 한국 공고뿐이고(app.audition) 하루 두 번 바뀐다 — 입시와 같이 홈을 열 때 한 번만 읽는다.
    api
      .auditions()
      .then((data) => {
        if (!cancelled) setAuditions(data);
      })
      .catch(() => {
        if (!cancelled) setAuditions(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 입시생(만 19세 이하)은 입시만, 만 20세 이상 입시생은 둘 다, 나머지는 오디션만 본다(SOMA-654).
  const sections = homeDeadlineSections(profile.me?.profile, kstDate());
  // 「입시·오디션 공고」 줄의 「이번 주 마감 N개」 — 오늘부터 7일 안에 마감하는 공고 수.
  const auditionsClosingSoon = useMemo(
    () => (auditions && isKorean() ? urgentAuditions(auditions.items, kstDate(), 1000).filter((r) => r.days <= 7).length : 0),
    [auditions],
  );

  const { days } = useMemo(() => buildWeekActivity(activityDays ?? []), [activityDays]);
  // 연속 연습 일수는 회차 시작 날짜를 한국 시간으로 센다(practice.library).
  const streak = useMemo(() => practiceStreak((activityDays ?? []).map((d) => d.created_at)), [activityDays]);
  const activityLoaded = activityDays !== null;
  // 「첫 연습 끝!」 안내는 연습 1회(노트 생긴 코칭·끝낸 리딩·올린 참여작)를 한 뒤에만 띄운다(SOMA-773).
  const practiced = (activityDays?.length ?? 0) > 0;

  // 연속일이 오늘 늘었으면(마지막으로 본 값보다 크면) 딱 한 번 축하한다 (SOMA-479).
  // 기록을 받기 전엔 판단하지 않는다 — 그 판정은 streakCelebrationStep 이 한다(SOMA-494).
  useEffect(() => {
    let cancelled = false;
    void readLastSeenStreak().then((lastSeen) => {
      if (cancelled) return;
      const step = streakCelebrationStep({ loaded: activityLoaded, lastSeen, current: streak });
      if (step.celebrate) setCelebrateStreak(streak);
      if (step.remember !== null) void writeLastSeenStreak(step.remember);
    });
    return () => {
      cancelled = true;
    };
  }, [activityLoaded, streak]);

  const loaded = groupsLoaded && scripts !== null && activityLoaded;
  // 첫 사용자 화면(뭐부터 해 볼까요?)과 탭바 숨김은 같은 판단 하나다(lib/practice/first-time) — 묶음·대본·연습한 날이 모두 없는 사람.
  // 묶음을 못 받았으면 첫 사용자로 보지 않는다 — 시작한 사람에게 첫 화면을 보이는 쪽이 더 이상하다.
  const firstTime = firstTimeStateFrom({
    loaded,
    groupsFailed,
    groups,
    scripts: scripts ?? [],
    practicedDays: activityDays?.length ?? 0,
  });
  const firstUser = firstTime === 'first';

  // 첫 사용자는 모든 탭에서 탭바를 숨긴다 — 한 곳에 적고 탭 레이아웃이 읽는다. 홈을 떠나도 지우지 않는다.
  // 무엇이든 시작한 뒤 홈에 오면 practiced 가 되어 탭바가 다시 보인다.
  useEffect(() => {
    setFirstTimeState(firstTime);
  }, [firstTime]);

  const waitingUpload = useWaitingUpload();
  const today = useMemo(
    () => pickToday({ groups, scripts: scripts ?? [], challenge: featured, now: new Date(), primary: primaryFeature(practices, new Date()) }),
    [groups, scripts, featured, practices],
  );

  // 「다음에 해 볼 것」(노트의 다음 테이크 문장) — 코칭 숙제와 최근 연습 줄에 쓴다. 목록에 없어 노트를 따로 읽는다.
  const nextTakes = useNextTakes([
    today.main.kind === 'coaching' ? today.main.notePracticeId : null,
    today.also?.kind === 'coaching' ? today.also.notePracticeId : null,
  ]);

  // 안드로이드 뒤로가기 — 홈에서는 바로 나가지 않는다. 안내 토스트를 띄우고, 2초 안에 한 번 더 누르면 앱을 닫는다(SOMA-771).
  const lastBackAt = useRef(0);
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'android') return;
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        const now = Date.now();
        if (lastBackAt.current > 0 && now - lastBackAt.current < EXIT_BACK_WINDOW_MS) {
          lastBackAt.current = 0;
          BackHandler.exitApp();
          return true;
        }
        lastBackAt.current = now;
        ToastAndroid.show(t('home.exitToast'), ToastAndroid.SHORT);
        return true;
      });
      return () => sub.remove();
    }, []),
  );

  // 이번 주 챌린지 — 메인 카드(주 기능이 챌린지일 때)와 「이것도 해 볼래요?」 줄에 쓴다.
  const needsChallenge = loaded && !firstUser && featured === null;
  useEffect(() => {
    if (!needsChallenge) return;
    let cancelled = false;
    api
      .listChallenges({ tab: 'popular' })
      .then((r) => {
        if (!cancelled && r.featured) setFeatured(r.featured);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [needsChallenge]);

  // 리딩 카드면 그 대본의 진행 중 회차에서 몇 줄까지 읽었는지 받아 온다.
  const readingItem = [today.main, today.also].find((i) => i?.kind === 'reading') as Extract<TodayItem, { kind: 'reading' }> | undefined;
  const coachingItem = [today.main, today.also].find((i) => i?.kind === 'coaching') as Extract<TodayItem, { kind: 'coaching' }> | undefined;
  const readingScriptId = readingItem?.script.id ?? null;
  useEffect(() => {
    if (!readingScriptId) return;
    let cancelled = false;
    api
      .listReadingSessions(readingScriptId)
      .then(async ({ sessions }) => {
        const open = sessions.find((s) => s.status === 'in_progress' && s.progress);
        const reached = open?.id ? await hasReachedEnd(open.id) : false;
        if (cancelled) return;
        setReadingProgress(
          open?.progress
            ? { scriptId: readingScriptId, progress: displayProgress(open.progress, reached), perLine: secPerLine(sessions) }
            : null,
        );
      })
      .catch(() => {
        if (!cancelled) setReadingProgress(null);
      });
    return () => {
      cancelled = true;
    };
  }, [readingScriptId]);

  const openCoaching = (group: PracticeGroup) => {
    const action = continueActionFor(group);
    if (action.kind === 'resume') {
      router.push({ pathname: '/coach', params: { practiceId: action.practiceId } });
      return;
    }
    const last = group.practices[group.practices.length - 1];
    setContinueOrigin({ kind: 'group', rootId: group.root_id, practiceId: last?.id ?? group.root_id });
    router.push('/upload');
  };

  const openReading = async (script: ScriptCard) => {
    const opened = await loadIntoCurrent(script.id);
    if (opened) router.push('/reading/detail');
    else router.push('/reading');
  };

  const openItem = (item: TodayItem) => {
    if (item.kind === 'coaching') openCoaching(item.group);
    else if (item.kind === 'reading') void openReading(item.script);
    else if (item.kind === 'challenge') router.push({ pathname: '/challenge-detail', params: { id: item.challenge.id } });
    else router.push('/coaching');
  };

  // 메인 카드 아래 「이것도 해 볼래요?」 세 줄(pen P1.1·P1.15·P1.16) — 메인이 아닌 기능 둘과 입시·오디션 공고.
  // 영상을 올리는 중이면 메인은 코칭이다. 챌린지가 메인이면 첫 줄은 다른 배우 영상 보기다.
  const mainKind: TodayItem['kind'] = waitingUpload.card ? 'coaching' : today.main.kind;
  const ddayOf = (c: ChallengeCard) => challengeDaysLeft(c.ends_at, new Date());
  const rowCoaching: HomeRowData = coachingItem
    ? {
        key: 'coaching',
        icon: 'video',
        title: t('home.rowCoachingHomework'),
        sub: nextTakes[coachingItem.notePracticeId] || sceneTitle(coachingItem.group),
        phLabel: 'home_row_coaching',
        onPress: () => openCoaching(coachingItem.group),
      }
    : {
        key: 'coaching',
        icon: 'video',
        title: mainKind === 'reading' ? t('home.rowCoachingFromReading') : t('home.rowCoaching'),
        sub: mainKind === 'reading' ? t('home.rowCoachingFromReadingSub') : t('home.rowCoachingSub'),
        phLabel: 'home_row_coaching',
        onPress: () => router.push('/coaching'),
      };
  const rowReading: HomeRowData = readingItem
    ? {
        key: 'reading',
        icon: 'book-open',
        title: t('home.alsoReading', { title: readingItem.script.title }),
        sub:
          readingProgress?.scriptId === readingItem.script.id && readingProgress.progress.total > 0
            ? t('home.rowReadingProgress', { done: readingProgress.progress.done, total: readingProgress.progress.total })
            : t('home.rowReadingNoProgress'),
        phLabel: 'home_row_reading',
        onPress: () => void openReading(readingItem.script),
      }
    : {
        key: 'reading',
        icon: 'book-open',
        title: t('home.rowReading'),
        sub: t('home.rowReadingSub'),
        phLabel: 'home_row_reading',
        onPress: () => router.push('/reading'),
      };
  const featuredDays = featured ? ddayOf(featured) : null;
  const rowChallenge: HomeRowData = {
    key: 'challenge',
    icon: 'award',
    title: t('home.rowChallenge'),
    sub: featured
      ? [`“${featured.line}”`, featuredDays !== null && featuredDays >= 0 ? `D-${featuredDays}` : null].filter(Boolean).join(' · ')
      : t('home.rowChallengeSub'),
    phLabel: 'home_row_challenge',
    onPress: () => (featured ? router.push({ pathname: '/challenge-detail', params: { id: featured.id } }) : router.push('/challenges')),
  };
  const rowWatch: HomeRowData = {
    key: 'watch',
    icon: 'play',
    title: t('home.rowWatch'),
    sub: t('home.rowWatchSub'),
    phLabel: 'home_row_watch',
    onPress: () => router.push('/challenges'),
  };
  const rowAuditions: HomeRowData | null = isKorean()
    ? {
        key: 'auditions',
        icon: 'volume-2',
        title: t('home.rowAuditions'),
        sub: auditionsClosingSoon > 0 ? t('home.rowAuditionsSub', { n: auditionsClosingSoon }) : t('home.rowAuditionsSubNone'),
        phLabel: 'home_row_auditions',
        // 만 19세 이하 입시생은 입시 일정만 본다(SOMA-654) — 오디션 모아보기 대신 입시로 간다.
        onPress: () => router.push(sections.auditions ? '/auditions' : '/admissions'),
      }
    : null;
  const homeRows: HomeRowData[] = [
    ...(mainKind === 'coaching' ? [rowReading, rowChallenge] : []),
    ...(mainKind === 'reading' ? [rowCoaching, rowChallenge] : []),
    ...(mainKind === 'challenge' ? [rowWatch, rowReading] : []),
    ...(mainKind === 'start' ? [rowReading, rowChallenge] : []),
    ...(rowAuditions ? [rowAuditions] : []),
  ];
  // 올리는 중에는 코칭 줄을 빼는데(위 coaching 메인 줄 목록에 코칭이 없다) 업로드 카드 아래에서도 같은 세 줄이다.

  // 맨 위 한 줄 인사 — 메인 카드에 맞춘다.
  const greeting = waitingUpload.card
    ? t('home.greetingUploading')
    : today.main.kind === 'reading'
      ? wasYesterday(today.main.script.last_practiced_at, new Date())
        ? t('home.greetingReadingYesterday')
        : t('home.greetingReading')
      : today.main.kind === 'challenge'
        ? t('home.greetingChallenge')
        : t('home.greeting');

  const bell = (
    <Pressable
      onPress={() => router.push('/notifications')}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={unread.count > 0 ? t('home.bellUnreadA11y') : t('home.bellA11y')}
      ph-label="home_bell"
      style={styles.bell}>
      <Feather name="bell" size={22} color={palette.text} />
      {unread.count > 0 && <View style={styles.bellDot} />}
    </Pressable>
  );

  return (
    <SafeAreaView style={[styles.safe, loaded && !firstUser && styles.safeHero]} edges={['top']}>
      {celebrateStreak !== null && overlaysReady && !guideOpen && !guideShownThisVisit && (
        <StreakCelebrationScreen
          streak={celebrateStreak}
          dots={celebrationDots(days)}
          onDone={() => setCelebrateStreak(null)}
        />
      )}
      {!loaded ? (
        <View style={styles.loading}>
          <ActivityIndicator color={palette.blue} />
        </View>
      ) : firstUser ? (
        // 첫 사용자 홈(pen P1.12 「뭐부터 해 볼까요?」) — 액티 말풍선 아래에서 하나를 고르면(회색 → 옅은 파랑) 아래 「다음」으로 그 탭에 들어간다.
        // 첫 줄(코칭)이 첫 가이드가 비추는 자리다.
        <View style={styles.flex}>
          <ScrollView contentContainerStyle={styles.firstContainer}>
            <MascotBubble source={MASCOT.coach} title={t('home.firstQuestion')} guide={t('home.firstPickSub')} />
            <View style={styles.firstChoices}>
              <FirstChoice
                targetRef={startTarget.ref}
                onLayout={startTarget.onLayout}
                icon="video"
                title={t('home.firstCoaching')}
                sub={t('home.firstCoachingSub')}
                selected={firstPick === 'coaching'}
                phLabel="home_first_coaching"
                onPress={() => setFirstPick('coaching')}
              />
              <View style={styles.firstPair}>
                <FirstChoice
                  half
                  icon="book-open"
                  title={t('home.firstReading')}
                  sub={t('home.firstReadingSub')}
                  selected={firstPick === 'reading'}
                  phLabel="home_first_reading"
                  onPress={() => setFirstPick('reading')}
                />
                <FirstChoice
                  half
                  icon="award"
                  title={t('home.firstChallenge')}
                  sub={t('home.firstChallengeSub')}
                  selected={firstPick === 'challenge'}
                  phLabel="home_first_challenge"
                  onPress={() => setFirstPick('challenge')}
                />
              </View>
            </View>
          </ScrollView>
          <View style={[styles.firstFooter, { paddingBottom: 11 + tabBarSpace }]}>
            <PrimaryButton
              label={t('home.firstContinue')}
              disabled={!firstPick}
              phLabel="home_first_continue"
              onPress={() => {
                if (firstPick) router.push(FIRST_PICK_ROUTE[firstPick]);
              }}
            />
          </View>
        </View>
      ) : (
        <ScrollView style={styles.scrollBg} contentContainerStyle={[styles.container, { paddingBottom: tabBarSpace + 20 }]} showsVerticalScrollIndicator={false}>
          {/* 히어로(pen P1.1) — 연한 파랑 바탕·창빛 장식 위에 인사와 책 위에서 읽는 액티, 오른쪽 위 알림 버튼. */}
          <View style={styles.hero}>
            <View style={styles.heroBg} pointerEvents="none">
              {HERO_FADE.map((c, i) => (
                <View key={i} style={{ height: i === 0 ? 190 : 10, backgroundColor: c }} />
              ))}
            </View>
            <Image source={require('@/assets/images/home/window-light.png')} style={styles.heroWindow} contentFit="cover" accessibilityIgnoresInvertColors />
            <View style={styles.heroText}>
              <Text style={styles.heroTitle} accessibilityRole="header">{t('home.heroTitle')}</Text>
              <Text style={styles.heroSub}>{t('home.heroSub')}</Text>
            </View>
            <Image source={require('@/assets/images/home/hero-acty-book.png')} style={styles.heroActy} contentFit="contain" accessibilityIgnoresInvertColors />
            {bell}
          </View>

          <View style={styles.body}>
          {/* 이번 주 연습 카드(pen P1.1) — 연속 일수와 요일별 점. 한 날은 파란 체크, 오늘은 파란 테두리. */}
          <View style={styles.weekCard} testID="home-week">
            <View style={styles.weekHead}>
              <Text style={styles.weekTitle}>{t('home.weekTitle')}</Text>
              {streak > 0 && (
                <View style={styles.streakPill} accessibilityLabel={t('home.streakA11y', { n: streak })}>
                  <Ionicons name="flame-outline" size={15} color={palette.flame} />
                  <Text style={styles.streakText}>{t('home.streakDaysRow', { n: streak })}</Text>
                </View>
              )}
            </View>
            <View style={styles.week}>
              {days.map((d) => (
                <View key={d.key} style={styles.weekCol}>
                  <View
                    testID={d.count > 0 ? 'home-week-done' : d.isToday ? 'home-week-today' : 'home-week-empty'}
                    style={[styles.weekDot, d.count > 0 && styles.weekDotDone, d.count === 0 && d.isToday && styles.weekDotToday]}>
                    {d.count > 0 && <Feather name="check" size={18} color={palette.onAccent} />}
                  </View>
                  <Text style={[styles.weekLabel, d.isToday && styles.weekLabelToday]}>{d.isToday ? t('home.today') : d.label}</Text>
                </View>
              ))}
            </View>
          </View>

          {/* 주 기능 카드 하나 — 첫 가이드가 비추는 자리다. 올리는 중이면 올리는 카드가 대신한다. */}
          {waitingUpload.card && <HomeUploadCard upload={waitingUpload} />}
          {!waitingUpload.card && (
            <View ref={startTarget.ref} onLayout={startTarget.onLayout} collapsable={false} style={styles.todayCard}>
              <TodayCardBody
                item={today.main}
                progress={
                  today.main.kind === 'reading' && readingProgress?.scriptId === today.main.script.id
                    ? readingProgress.progress
                    : null
                }
                perLine={today.main.kind === 'reading' && readingProgress ? readingProgress.perLine : undefined}
                nextTake={today.main.kind === 'coaching' ? nextTakes[today.main.notePracticeId] ?? null : null}
                onPress={() => openItem(today.main)}
              />
            </View>
          )}

          {/* 이것도 해 볼래요? — 세 줄. */}
          <Text style={styles.sectionTitle} accessibilityRole="header">{t('home.moreTitle')}</Text>
          {homeRows.map((row) => (
            <Pressable
              key={row.key}
              onPress={row.onPress}
              accessibilityRole="button"
              ph-label={row.phLabel}
              style={({ pressed }) => [styles.listRow, pressed && styles.pressed]}>
              <View style={styles.rowIcon}>
                <Feather name={row.icon} size={20} color={palette.textDim} />
              </View>
              <View style={styles.flex}>
                <Text style={styles.listTitle} numberOfLines={1}>{row.title}</Text>
                <Text style={styles.listMeta} numberOfLines={1}>{row.sub}</Text>
              </View>
              <Feather name="chevron-right" size={18} color={palette.checkOff} />
            </Pressable>
          ))}
          </View>
        </ScrollView>
      )}

      <SpotlightGuide
        visible={guideOpen && overlaysReady && loaded && !firstUser && practiced}
        topic="home"
        steps={HOME_STEPS}
        onDone={() => {
          setGuideOpen(false);
          setGuideShownThisVisit(true);
          void markSpotlightSeen('home');
        }}
      />
      <AnnouncementPoster
        loggedIn={!!user}
        blocked={!overlaysReady || !introChecked || !guideChecked || guideOpen || guideShownThisVisit || celebrateStreak !== null}
        onboardingJustFinished={onboardingJustFinished}
      />
    </SafeAreaView>
  );
}

type HomeRowData = {
  key: string;
  icon: ComponentProps<typeof Feather>['name'];
  title: string;
  sub: string;
  phLabel: string;
  onPress: () => void;
};

/** 주 기능 카드 속 — 종류마다 머리 한 줄(주황 아이콘·글자)·제목·보조·진행 막대·주 버튼. */
function TodayCardBody({
  item,
  nextTake = null,
  progress,
  perLine,
  onPress,
}: {
  item: TodayItem;
  nextTake?: string | null;
  progress: SessionProgress | null;
  perLine?: number;
  onPress: () => void;
}) {
  let eyebrow: string;
  let icon: ComponentProps<typeof Feather>['name'] | 'trophy' = 'video';
  let title: string;
  let sub: string | null = null;
  let remaining: string | null = null;
  let cta: string;
  let bar: number | null = null;

  if (item.kind === 'coaching') {
    const action = continueActionFor(item.group);
    eyebrow = t('home.todayCoachingEyebrow');
    // 제목은 지난 노트의 「다음에 해 볼 것」이다. 그 문장이 없으면(아직 못 받았거나 노트에 없음) 장면 제목만 둔다.
    const n = item.group.ordinal_count + 1;
    title = nextTake ? `「${nextTake}」` : sceneTitle(item.group);
    sub = nextTake ? t('home.todayCoachingSub', { title: sceneTitle(item.group), n }) : t('home.todayCoachingSubTake', { n });
    cta = action.kind === 'resume' ? t('history.resumeConversation') : t('home.todayCoachingCta');
  } else if (item.kind === 'reading') {
    icon = 'book-open';
    // 한 번도 안 읽은 대본은 「이어 읽기」가 아니다(10/22 피드백).
    eyebrow = progress || item.script.last_practiced_at ? t('home.todayReadingEyebrow') : t('home.todayReadingEyebrowNew');
    title = item.script.title;
    if (progress && progress.total > 0) {
      bar = Math.min(1, Math.max(0, progress.done / progress.total));
      sub = t('home.todayReadingProgress', { total: progress.total, done: progress.done });
      const minutes = remainingMinutes(progress, perLine ?? DEFAULT_SEC_PER_LINE);
      if (minutes !== null) remaining = t('home.todayReadingRemaining', { minutes });
      cta = progress.done < progress.total ? t('home.todayReadingCta', { line: progress.done + 1 }) : t('home.todayReadingCtaPlain');
    } else {
      // 만들어 두고 아직 안 읽은 대본은 「리딩 시작하기」(pen P1.15 「새로 넣은 대본이에요 · 대사 N줄」).
      if (!item.script.last_practiced_at && item.script.dialogue_count > 0) sub = t('home.todayReadingNewSub', { n: item.script.dialogue_count });
      cta = item.script.last_practiced_at ? t('home.todayReadingCtaPlain') : t('home.todayReadingCtaStart');
    }
  } else if (item.kind === 'challenge') {
    icon = 'trophy';
    eyebrow = item.daysLeft === 0 ? t('home.todayChallengeEyebrowToday') : t('home.todayChallengeEyebrow', { days: item.daysLeft });
    title = `“${item.challenge.line}”`;
    sub = item.challenge.entry_count && item.challenge.entry_count > 0 ? t('home.todayChallengeSub', { n: item.challenge.entry_count }) : t('home.rowChallengeSub');
    cta = t('home.todayChallengeCta');
  } else {
    eyebrow = t('home.todayStartEyebrow');
    title = t('home.todayStartTitle');
    sub = t('home.todayStartSub');
    cta = t('home.todayStartCta');
  }

  return (
    <>
      <View style={styles.eyebrowRow}>
        {icon === 'trophy' ? (
          <Ionicons name="trophy-outline" size={16} color={palette.onAccent} />
        ) : (
          <Feather name={icon} size={16} color={palette.onAccent} />
        )}
        <Text style={styles.eyebrow}>{eyebrow}</Text>
      </View>
      <Text style={styles.todayTitle} numberOfLines={3}>{title}</Text>
      {sub ? <Text style={styles.todaySub} numberOfLines={2}>{sub}</Text> : null}
      {remaining ? <Text style={styles.todaySub}>{remaining}</Text> : null}
      {bar !== null && (
        <View style={styles.barTrack}>
          <View style={[styles.barFill, { width: `${Math.round(bar * 100)}%` }]} />
        </View>
      )}
      <View style={styles.todaySpacer} />
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={cta}
        style={({ pressed }) => [styles.todayCta, pressed && styles.pressed]}>
        <Text style={styles.todayCtaText}>{cta}</Text>
        <Feather name="arrow-right" size={16} color={palette.blue} />
      </Pressable>
    </>
  );
}

/**
 * 첫 사용자 홈의 선택 카드(pen P1.12) — 안 골랐을 땐 회색 카드(#F2F4F6, 모서리 16)에 아이콘·제목 18/700·설명 14,
 * 고르면 옅은 파랑 바탕에 파란 테두리·파란 제목(코칭 카드는 오른쪽에 체크). 기본 선택은 없고 아래 「다음」을 눌러야 넘어간다.
 * `half`면 둘이 나란히 놓이는 반쪽 카드다.
 */
function FirstChoice({
  icon,
  title,
  sub,
  selected,
  half = false,
  phLabel,
  onPress,
  targetRef,
  onLayout,
}: {
  icon: ComponentProps<typeof Feather>['name'];
  title: string;
  sub: string;
  selected: boolean;
  half?: boolean;
  phLabel: string;
  onPress: () => void;
  targetRef?: Ref<View>;
  onLayout?: (e: LayoutChangeEvent) => void;
}) {
  return (
    <Pressable
      ref={targetRef}
      onLayout={onLayout}
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={title}
      accessibilityHint={sub}
      ph-label={phLabel}
      style={({ pressed }) => [styles.choice, half && styles.choiceHalf, selected && styles.choiceOn, pressed && !selected && styles.pressed]}>
      <View style={styles.choiceTop}>
        <Feather name={icon} size={22} color={selected ? palette.blue : palette.textDim} />
        {selected && !half ? <Feather name="check" size={20} color={palette.blue} /> : null}
      </View>
      <Text style={[styles.choiceText, selected && styles.choiceTextOn]}>{title}</Text>
      <Text style={styles.choiceSub}>{sub}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  safeHero: { backgroundColor: '#E4EEFC' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  // 아래 탭 바가 화면 위에 떠 있어 그만큼 바닥을 비운다.
  scrollBg: { backgroundColor: '#F7FAFE' },
  container: {},
  flex: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.85 },

  // 첫 사용자 홈
  firstContainer: { paddingTop: 80, paddingHorizontal: 24, paddingBottom: 24 },
  firstChoices: { gap: 12, marginTop: 48 },
  firstPair: { flexDirection: 'row', gap: 12 },
  firstFooter: { paddingHorizontal: 24, paddingTop: 8 },
  choice: {
    gap: 6,
    paddingVertical: 20,
    paddingHorizontal: 20,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: palette.border,
    backgroundColor: palette.card,
  },
  choiceHalf: { flex: 1, minWidth: 0, paddingHorizontal: 16 },
  choiceOn: { backgroundColor: palette.blueSoft, borderColor: palette.blue },
  choiceTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  choiceText: { fontSize: 18, fontWeight: '700', lineHeight: 24, color: palette.text },
  choiceTextOn: { color: palette.blueDeep },
  choiceSub: { fontSize: 14, fontWeight: '400', lineHeight: 21, color: palette.textMuted },

  // 히어로
  hero: { height: 200 + 44 },
  heroBg: { position: 'absolute', top: 0, left: 0, right: 0, height: 250 },
  heroWindow: { position: 'absolute', top: 0, left: 0, width: 440, height: 265, opacity: 0.9 },
  heroText: { position: 'absolute', top: 52, left: 24, width: 190, gap: 10 },
  heroTitle: { fontSize: 26, fontWeight: '800', lineHeight: 34, color: palette.text },
  heroSub: { fontSize: 13, fontWeight: '400', lineHeight: 20, color: palette.textMuted },
  heroActy: { position: 'absolute', top: 56, right: 14, width: 170, height: 188 },
  body: { paddingHorizontal: 20, paddingTop: 4, gap: 16 },
  streakPill: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  streakText: { fontSize: 13, fontWeight: '700', color: palette.textStrong },
  bell: { position: 'absolute', top: 14, right: 20, width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.9)', alignItems: 'center', justifyContent: 'center' },
  bellDot: {
    position: 'absolute',
    top: 10,
    right: 11,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: palette.flame,
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },

  // 이번 주 연습 카드
  weekCard: { backgroundColor: palette.card, borderRadius: 20, borderWidth: 1, borderColor: '#E8EDF5', paddingTop: 16, paddingHorizontal: 16, paddingBottom: 14, gap: 14 },
  weekHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  weekTitle: { fontSize: 16, fontWeight: '800', color: palette.text },
  week: { flexDirection: 'row', justifyContent: 'space-between' },
  weekCol: { alignItems: 'center', gap: 6, width: 40 },
  weekDot: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#EEF1F6', alignItems: 'center', justifyContent: 'center' },
  weekDotDone: { backgroundColor: palette.blue },
  weekDotToday: { backgroundColor: palette.card, borderWidth: 2, borderColor: palette.blue },
  weekLabel: { fontSize: 12, fontWeight: '500', lineHeight: 16, color: '#7A8496' },
  weekLabelToday: { fontWeight: '800', color: palette.text },

  // 추천 연습 카드(pen P1.1) — 어두운 바탕에 흰 글자, 흰 알약 버튼. 올리는 중 카드도 같은 모양이다.
  todayCard: {
    minHeight: 196,
    backgroundColor: DARK_CARD,
    borderRadius: 22,
    paddingVertical: 18,
    paddingHorizontal: 20,
    gap: 8,
    overflow: 'hidden',
    shadowColor: '#2F6EF2',
    shadowOpacity: 0.25,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6,
  },
  eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  eyebrow: { fontSize: 13, fontWeight: '600', lineHeight: 18, color: 'rgba(255,255,255,0.9)' },
  todayTitle: { fontSize: 20, fontWeight: '800', lineHeight: 27, color: palette.onAccent, maxWidth: 260 },
  barTrack: { height: 8, width: 200, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.3)', overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 4, backgroundColor: palette.onAccent },
  todaySub: { fontSize: 12, fontWeight: '400', lineHeight: 18, color: 'rgba(255,255,255,0.8)' },
  todaySpacer: { flex: 1, minHeight: 2 },
  todayCta: {
    alignSelf: 'flex-start',
    height: 42,
    borderRadius: 21,
    paddingHorizontal: 22,
    backgroundColor: palette.onAccent,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  todayCtaText: { fontSize: 15, fontWeight: '800', color: palette.blue },

  // 이것도 해 볼래요?
  sectionTitle: { marginTop: 32, marginBottom: 4, fontSize: 15, fontWeight: '700', lineHeight: 22, color: palette.textDim },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 10 },
  rowIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: palette.bgSoft, alignItems: 'center', justifyContent: 'center' },
  listTitle: { fontSize: 16, fontWeight: '700', lineHeight: 22, color: palette.text },
  listMeta: { marginTop: 2, fontSize: 13, fontWeight: '400', lineHeight: 19, color: palette.textFaint },
});

