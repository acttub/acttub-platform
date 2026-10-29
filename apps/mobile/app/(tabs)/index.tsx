import Feather from '@expo/vector-icons/Feather';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps, type Ref } from 'react';
import { BackHandler, Platform, Pressable, ScrollView, StyleSheet, Text, ToastAndroid, View, type LayoutChangeEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AdSlot } from '@/components/ad-slot';
import { PrimaryButton } from '@/components/ui/buttons';
import { useTabBarSpace } from '@/components/ui/tab-bar';
import { MASCOT } from '@/components/ui/mascot';
import { MascotBubble } from '@/components/ui/mascot-bubble';
import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';
import { api } from '@/lib/api';
import { buildRecentActivity } from '@/lib/practice-activity';
import { practiceStreak, sceneTitle } from '@/lib/practice/groups';
import type { PracticeGroup } from '@/lib/practice/types';
import { continueActionFor } from '@/lib/practice/resume';
import { setContinueOrigin } from '@/lib/practice/session-state';
import { rememberPracticeDays } from '@/lib/practice-days';
import { dDayLabel } from '@/lib/challenge/browse';
import { countedPractices, type CountedPractice } from '@/lib/practice/counted';
import { skipsHomeGuide } from '@/lib/returning-account';
import { hasSeenSpotlight, hasSeenTutorial, markSpotlightSeen, markTutorialSeen } from '@/lib/guide-state';
import { currentTutorial } from '@/lib/tutorial';
import { kstDate, urgentAuditions, type AuditionPostingList } from '@/lib/auditions';
import { upcomingNotices, type AdmissionsResponse } from '@/lib/admissions';
import { isKorean, translate as t, translateList } from '@/lib/i18n';
import { firstTimeStateFrom, setFirstTimeState } from '@/lib/practice/first-time';
import { currentFirstUseOwner, hasGraduatedFirstUse } from '@/lib/practice/first-use-graduation';
import { challengeDaysLeft, pickToday, primaryFeature, type TodayItem } from '@/lib/home-today';
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
import { markHomeReady } from '@/lib/launch-splash';
import { SkeletonBlock, SkeletonGroup } from '@/components/ui/skeleton';
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

/** 첫 사용자 홈에서 고른 길 → 「계속하기」가 가는 탭. 챌린지는 첫 연습을 끝낸 뒤에 보인다(SOMA-827) — 코칭·리딩 둘만. */
type FirstPick = 'coaching' | 'reading';
const FIRST_PICK_ROUTE: Record<FirstPick, '/coaching' | '/reading'> = {
  coaching: '/coaching',
  reading: '/reading',
};

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
  /** 이 기기에서 리딩·코칭을 끝까지 해 본 계정인가(SOMA-827). 읽기 전엔 null — 첫 사용자 화면을 함부로 띄우지 않는다. */
  const [graduated, setGraduated] = useState<boolean | null>(null);
  // 주 기능 판단용 — 센 연습(코칭·리딩·챌린지) 목록.
  const [practices, setPractices] = useState<CountedPractice[]>([]);
  // 내가 참여작을 올린 챌린지 — 홈 챌린지 카드가 이미 찍은 챌린지에 「찍으러 가기」를 띄우지 않게 한다(SOMA-829).
  const [enteredChallengeIds, setEnteredChallengeIds] = useState<ReadonlySet<string>>(() => new Set());
  const [auditions, setAuditions] = useState<AuditionPostingList | null>(null);
  const [admissions, setAdmissions] = useState<AdmissionsResponse | null>(null);
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
  // 첫 항목(코칭)을 미리 골라 둔다(UX 가이드 5절 — 첫 사용자 홈 포함, 10/23). 다른 것을 누르면 바뀌고 「다음」으로 넘어간다.
  const [firstPick, setFirstPick] = useState<FirstPick | null>('coaching');
  const tabBarSpace = useTabBarSpace();
  const firstName = profile.me?.profile?.name?.trim() ?? '';
  // 졸업 표시(SOMA-827)는 계정별이라 내 계정을 알고 나서 읽는다. 앱을 막 켰을 때 계정보다 먼저 읽으면 「아니」로 굳었다.
  const meId = profile.me?.id ?? null;
  const [graduationCheck, setGraduationCheck] = useState(0);
  useFocusEffect(useCallback(() => setGraduationCheck((n) => n + 1), []));
  useEffect(() => {
    if (!meId) return;
    let live = true;
    void hasGraduatedFirstUse(meId).then((done) => {
      if (live) setGraduated(done);
    });
    return () => {
      live = false;
    };
  }, [meId, graduationCheck]);

  // 이미 연습이 쌓인 계정(앱을 다시 깐 기존 사용자)에게는 「첫 연습 끝!」 안내를 띄우지 않고 본 것으로 남긴다(10/26).
  useEffect(() => {
    if (!guideOpen || !skipsHomeGuide(practices.length)) return;
    setGuideOpen(false);
    void markSpotlightSeen('home');
  }, [guideOpen, practices.length]);

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
        setEnteredChallengeIds(new Set(entries.flatMap((entry) => (entry.challenge?.id ? [entry.challenge.id] : []))));
        setPractices(counted);
        return rememberPracticeDays(counted.map((p) => ({ created_at: p.at })), currentFirstUseOwner()).then((days) => {
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

  // 연기 입시 일정 — 입시생에게만 보이는 구역이라 입시생일 때만 읽는다(SOMA-654). 실패하면 구역만 빠진다.
  const wantsAdmissions = isKorean() && homeDeadlineSections(profile.me?.profile, kstDate()).admissions;
  useEffect(() => {
    if (!wantsAdmissions) return;
    let cancelled = false;
    api
      .admissions()
      .then((data) => {
        if (!cancelled) setAdmissions(data);
      })
      .catch(() => {
        if (!cancelled) setAdmissions(null);
      });
    return () => {
      cancelled = true;
    };
  }, [wantsAdmissions]);

  // 입시생(만 19세 이하)은 입시만, 만 20세 이상 입시생은 둘 다, 나머지는 오디션만 본다(SOMA-654).
  const sections = homeDeadlineSections(profile.me?.profile, kstDate());


  // 오늘이 맨 오른쪽인 최근 7일.
  const { days } = useMemo(() => buildRecentActivity(activityDays ?? []), [activityDays]);
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

  const loaded = groupsLoaded && scripts !== null && activityLoaded && graduated !== null;
  // 첫 데이터를 다 받으면 앱을 켤 때 붙잡아 둔 로고를 닫게 한다.
  useEffect(() => {
    if (loaded) markHomeReady();
  }, [loaded]);
  // 첫 사용자 화면(뭐부터 해 볼까요?)과 탭바 숨김은 같은 판단 하나다(lib/practice/first-time) — 묶음·대본·연습한 날이 모두 없는 사람.
  // 묶음을 못 받았으면 첫 사용자로 보지 않는다 — 시작한 사람에게 첫 화면을 보이는 쪽이 더 이상하다.
  const firstTime = firstTimeStateFrom({
    loaded,
    groupsFailed,
    groups,
    scripts: scripts ?? [],
    practicedDays: activityDays?.length ?? 0,
    graduated: !!graduated,
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
        // pen P1.1 — 제목은 「대사 이어 읽기」, 아래 줄은 멈춘 줄(없으면 대본 제목).
        title: t('home.rowReadingContinue'),
        sub:
          readingProgress?.scriptId === readingItem.script.id && readingProgress.progress.total > 0
            ? t('home.rowReadingProgress', { done: readingProgress.progress.done, total: readingProgress.progress.total })
            : readingItem.script.title,
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
    tone: 'orange',
    title: t('home.rowChallenge'),
    sub: featured
      ? [`‘${featured.line}’`, featuredDays !== null && featuredDays >= 0 ? dDayLabel(featured) : null].filter(Boolean).join(' · ')
      : t('home.rowChallengeSub'),
    phLabel: 'home_row_challenge',
    onPress: () => (featured ? router.push({ pathname: '/challenge-detail', params: { id: featured.id } }) : router.push('/challenges')),
  };
  const rowWatch: HomeRowData = {
    key: 'watch',
    icon: 'play',
    tone: 'orange',
    title: t('home.rowWatch'),
    // pen P1.16 「이번 주 참여작 12개」 — 참여작이 없으면 정렬 안내.
    sub: featured && featured.entry_count > 0 ? t('home.rowWatchSubCount', { n: featured.entry_count }) : t('home.rowWatchSub'),
    phLabel: 'home_row_watch',
    onPress: () => router.push('/challenges'),
  };
  const homeRows: HomeRowData[] = [
    ...(mainKind === 'coaching' ? [rowReading, rowChallenge] : []),
    ...(mainKind === 'reading' ? [rowCoaching, rowChallenge] : []),
    ...(mainKind === 'challenge' ? [rowWatch, rowReading] : []),
    ...(mainKind === 'start' ? [rowReading, rowChallenge] : []),
  ];
  // 올리는 중에는 코칭 줄을 빼는데(위 coaching 메인 줄 목록에 코칭이 없다) 업로드 카드 아래에서도 같은 세 줄이다.

  // 마감 임박 두 구역(pen P1.1·P1.3) — 입시 일정(입시생만)과 오디션 공고. 가까운 순 둘, 없으면 구역을 그리지 않는다.
  const todayKst = kstDate();
  const deadlineBlocks: DeadlineBlock[] = [];
  if (sections.admissions && admissions) {
    const rows = upcomingNotices(admissions, todayKst, 2).map(({ university, notice, remaining }) => ({
      id: notice.id,
      days: remaining.days,
      title: university.name,
      sub: [notice.department, notice.practical_date ? t('home.admissionPractical', { date: monthDay(notice.practical_date) }) : remaining.label]
        .filter(Boolean)
        .join(' · '),
    }));
    if (rows.length > 0) deadlineBlocks.push({ key: 'admissions', title: t('home.admissionsTitle'), a11y: t('home.admissionsA11y'), route: '/admissions', rows });
  }
  if (sections.auditions && auditions) {
    const rows = urgentAuditions(auditions.items, todayKst, 2).map(({ posting, days }) => ({
      id: posting.id,
      days,
      title: posting.title,
      sub: posting.source_name,
    }));
    if (rows.length > 0) deadlineBlocks.push({ key: 'auditions', title: t('home.auditionsTitle'), a11y: t('home.auditionsA11y'), route: '/auditions', rows });
  }


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
        // 앱을 켤 때는 로고가 이 자리를 덮고 있다(lib/launch-splash.ts). 서버가 느려 로고가 먼저 닫히면 뼈대 화면이 보인다(SOMA-828).
        <HomeSkeleton />
      ) : firstUser ? (
        // 첫 사용자 홈(pen P1.12 「뭐부터 해 볼까요?」) — 액티 말풍선 아래에서 하나를 고르면(회색 → 옅은 파랑) 아래 「다음」으로 그 탭에 들어간다.
        // 첫 줄(코칭)이 첫 가이드가 비추는 자리다.
        <View style={styles.flex}>
          <ScrollView contentContainerStyle={styles.firstContainer}>
            <MascotBubble
              source={MASCOT.coach}
              title={firstName ? t('home.firstHello', { name: firstName }) : t('home.firstHelloNoName')}
              guide={t('home.firstIntro')}
            />
            <View style={styles.firstQuestion}>
              <Text style={styles.firstQuestionTitle} accessibilityRole="header">{t('home.firstQuestion')}</Text>
              <Text style={styles.firstQuestionSub}>{t('home.firstPickSub')}</Text>
            </View>
            <View style={styles.firstChoices}>
              <FirstChoice
                targetRef={startTarget.ref}
                onLayout={startTarget.onLayout}
                icon="video"
                title={t('home.firstCoaching')}
                sub={t('home.firstCoachingSub')}
                steps={translateList('home.firstCoachingSteps')}
                selected={firstPick === 'coaching'}
                phLabel="home_first_coaching"
                onPress={() => setFirstPick('coaching')}
              />
              <FirstChoice
                icon="book-open"
                title={t('home.firstReading')}
                sub={t('home.firstReadingSub')}
                steps={translateList('home.firstReadingSteps')}
                selected={firstPick === 'reading'}
                phLabel="home_first_reading"
                onPress={() => setFirstPick('reading')}
              />
            </View>
          </ScrollView>
          <View style={[styles.firstFooter, { paddingBottom: space[3] + tabBarSpace }]}>
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
        <ScrollView style={styles.scrollBg} contentContainerStyle={{ paddingBottom: tabBarSpace + space[5] }} showsVerticalScrollIndicator={false}>
          {/* 히어로(pen 「홈」) — 인사·책 읽는 액티·알림 버튼과 이번 주 연습 카드. */}
          {/* 요소·배치는 개편본, 배경(위에서 옅어지는 파랑 띠·창문 빛·연한 바탕)은 예전 것(SOMA-923). */}
          <View style={styles.heroBand}>
            {/* iOS 에서 위로 당기면(바운스) 히어로 위가 비어 스크롤 바탕색이 띠처럼 보였다 — 히어로 첫 색을 위로 길게 깐다(SOMA-924). */}
            <View style={styles.overscrollFill} pointerEvents="none" />
            <View style={styles.heroBg} pointerEvents="none">
              {HERO_FADE.map((c, i) => (
                <View key={i} style={{ height: i === 0 ? 190 : 10, backgroundColor: c }} />
              ))}
            </View>
            <Image source={require('@/assets/images/home/window-light.png')} style={styles.heroWindow} contentFit="cover" accessibilityIgnoresInvertColors />
            <View style={styles.hero}>
              <View style={styles.heroText}>
                <Text style={styles.heroTitle} accessibilityRole="header">{t('home.heroTitle')}</Text>
                <Text style={styles.heroSub}>{t('home.heroSub')}</Text>
              </View>
              <Image source={require('@/assets/images/home/hero-acty-book.png')} style={styles.heroActy} contentFit="contain" cachePolicy="memory-disk" accessibilityIgnoresInvertColors />
              {bell}
            </View>
            <View style={styles.weekCard} testID="home-week">
              <View style={styles.weekHead}>
                <Text style={styles.weekTitle}>{t('home.weekTitle')}</Text>
                {streak > 0 && (
                  <View style={styles.streakPill} accessibilityLabel={t('home.streakA11y', { n: streak })}>
                    <Ionicons name="flame-outline" size={16} color={palette.flame} />
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
          </View>

          <View style={styles.body}>
          <AdSlot slot="home_top" />
          {/* 주 기능 카드 하나 — 첫 가이드가 비추는 자리다. 올리는 중이면 올리는 카드가 대신한다. */}
          {waitingUpload.card && <HomeUploadCard upload={waitingUpload} />}
          {!waitingUpload.card && (
              <TodayCardBody
                // 첫 가이드가 비추는 자리 — 카드(TodayCardBody 안 Pressable)에 준다.
                cardRef={startTarget.ref}
                onCardLayout={startTarget.onLayout}
                onPress={() => openItem(today.main)}
                item={today.main}
                challengeEntered={today.main.kind === 'challenge' && enteredChallengeIds.has(today.main.challenge.id)}
                progress={
                  today.main.kind === 'reading' && readingProgress?.scriptId === today.main.script.id
                    ? readingProgress.progress
                    : null
                }
                perLine={today.main.kind === 'reading' && readingProgress ? readingProgress.perLine : undefined}
                nextTake={today.main.kind === 'coaching' ? nextTakes[today.main.notePracticeId] ?? null : null}
              />
          )}

          {/* 이것도 해 볼까요? — 카드 줄(pen P1.1). */}
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle} accessibilityRole="header">{t('home.moreTitle')}</Text>
          </View>
          <View style={styles.rowList}>
            {homeRows.map((row) => (
              <Pressable
                key={row.key}
                onPress={row.onPress}
                accessibilityRole="button"
                ph-label={row.phLabel}
                style={({ pressed }) => [styles.listRow, pressed && styles.pressed]}>
                <View style={[styles.rowIcon, row.tone === 'orange' && styles.rowIconOrange]}>
                  {row.tone === 'orange' ? (
                    <Ionicons name={row.icon === 'award' ? 'trophy-outline' : 'play-outline'} size={20} color={palette.flame} />
                  ) : (
                    <Feather name={row.icon} size={20} color={palette.blue} />
                  )}
                </View>
                <View style={styles.flex}>
                  <Text style={styles.listTitle} numberOfLines={1}>{row.title}</Text>
                  <Text style={styles.listMeta} numberOfLines={1}>{row.sub}</Text>
                </View>
                <Feather name="chevron-right" size={18} color={palette.iconFaint} />
              </Pressable>
            ))}
          </View>

          {/* 연기 입시(입시생만)·오디션 마감 임박 — 가까운 마감 두 줄씩(pen P1.1). 없으면 구역째 그리지 않는다(P1.3). */}
          {deadlineBlocks.map((block) => (
            <View key={block.key} style={styles.deadlineBlock}>
              <View style={styles.sectionHead}>
                <Text style={styles.sectionTitle} accessibilityRole="header">{block.title}</Text>
                <Pressable onPress={() => router.push(block.route)} hitSlop={8} accessibilityRole="link" accessibilityLabel={block.a11y} ph-label={`home_${block.key}_all`}>
                  <Text style={styles.sectionAll}>{t('home.seeAll')}</Text>
                </Pressable>
              </View>
              <View style={styles.deadlineList}>
                {block.rows.map((row) => (
                  <Pressable
                    key={row.id}
                    onPress={() => router.push(block.route)}
                    accessibilityRole="button"
                    ph-label={`home_${block.key}_row`}
                    style={({ pressed }) => [styles.deadlineRow, pressed && styles.pressed]}>
                    <View style={[styles.dday, ddayTone(row.days).box]}>
                      <Text style={[styles.ddayText, ddayTone(row.days).text]}>D-{row.days === 0 ? 'DAY' : row.days}</Text>
                    </View>
                    <View style={styles.flex}>
                      <Text style={styles.listTitle} numberOfLines={2}>{row.title}</Text>
                      <Text style={styles.listMeta} numberOfLines={1}>{row.sub}</Text>
                    </View>
                    <Feather name="chevron-right" size={18} color={palette.iconFaint} />
                  </Pressable>
                ))}
              </View>
            </View>
          ))}
          </View>
        </ScrollView>
      )}

      <SpotlightGuide
        visible={guideOpen && overlaysReady && loaded && !firstUser && practiced && !skipsHomeGuide(practices.length)}
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

type DeadlineBlock = {
  key: 'admissions' | 'auditions';
  title: string;
  a11y: string;
  route: '/admissions' | '/auditions';
  rows: { id: string; days: number; title: string; sub: string }[];
};

/** D-day 배지 — 3일 안은 danger, 10일 안은 amber, 그 밖은 파랑. */
function ddayTone(days: number): { box: { backgroundColor: string }; text: { color: string } } {
  if (days <= 3) return { box: { backgroundColor: palette.dangerSoft }, text: { color: palette.danger } };
  if (days <= 10) return { box: { backgroundColor: palette.amberSoft }, text: { color: palette.amber } };
  return { box: { backgroundColor: palette.blueSoft }, text: { color: palette.blueDeep } };
}

/** 2026-10-26 → 10월 26일. */
function monthDay(date: string): string {
  const m = date.match(/^\d{4}-(\d{2})-(\d{2})/);
  return m ? t('home.monthDay', { m: Number(m[1]), d: Number(m[2]) }) : date;
}

type HomeRowData = {
  key: string;
  icon: ComponentProps<typeof Feather>['name'];
  title: string;
  sub: string;
  phLabel: string;
  /** orange 면 아이콘 칸이 주황(챌린지·영상 보기) — 나머지는 파랑. */
  tone?: 'orange';
  onPress: () => void;
};

/** 주 기능 카드 속 — 종류마다 머리 한 줄(주황 아이콘·글자)·제목·보조·진행 막대·주 버튼. */
function TodayCardBody({
  item,
  challengeEntered = false,
  nextTake = null,
  progress,
  perLine,
  onPress,
  cardRef,
  onCardLayout,
}: {
  item: TodayItem;
  /** 이 챌린지에 이미 참여작을 올렸는가 — 그러면 다시 찍으라고 하지 않고 다른 연기를 보러 가게 한다. */
  challengeEntered?: boolean;
  nextTake?: string | null;
  progress: SessionProgress | null;
  perLine?: number;
  onPress: () => void;
  cardRef?: Ref<View>;
  onCardLayout?: ComponentProps<typeof View>['onLayout'];
}) {
  let eyebrow: string;
  let icon: ComponentProps<typeof Feather>['name'] | 'trophy' = 'video';
  let title: string;
  let sub: string | null = null;
  let cta: string;

  if (item.kind === 'coaching') {
    const action = continueActionFor(item.group);
    eyebrow = t('home.todayCoachingEyebrow');
    // 제목은 지난 노트의 「다음에 해 볼 것」이다. 그 문장이 없으면(아직 못 받았거나 노트에 없음) 장면 제목만 둔다.
    const n = item.group.ordinal_count + 1;
    title = nextTake ? `‘${nextTake}’` : sceneTitle(item.group);
    sub = nextTake ? t('home.todayCoachingSub', { title: sceneTitle(item.group), n }) : t('home.todayCoachingSubTake', { n });
    cta = action.kind === 'resume' ? t('history.resumeConversation') : t('home.todayCoachingCta');
  } else if (item.kind === 'reading') {
    icon = 'book-open';
    // 한 번도 안 읽은 대본은 「이어 읽기」가 아니다(10/22 피드백).
    eyebrow = progress || item.script.last_practiced_at ? t('home.todayReadingEyebrow') : t('home.todayReadingEyebrowNew');
    // pen P1.15 「옥상, 밤 · 태오」 — 대본 제목 · 내 배역.
    const role = item.script.my_character_names[0]?.trim();
    title = role ? `${item.script.title} · ${role}` : item.script.title;
    if (progress && progress.total > 0) {
      // pen P1.15 — 「3/10줄 · 남은 시간 약 1분」 한 줄, 진행 막대는 없다.
      const minutes = remainingMinutes(progress, perLine ?? DEFAULT_SEC_PER_LINE);
      sub = [
        t('home.todayReadingProgress', { total: progress.total, done: progress.done }),
        minutes !== null ? t('home.todayReadingRemaining', { minutes }) : null,
      ]
        .filter(Boolean)
        .join(' · ');
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
    const n = item.challenge.entry_count ?? 0;
    if (challengeEntered) {
      sub = n > 0 ? t('home.todayChallengeSubEntered', { n }) : t('home.todayChallengeSubEnteredPlain');
      cta = t('home.todayChallengeCtaEntered');
    } else {
      sub = n > 0 ? t('home.todayChallengeSub', { n }) : t('home.rowChallengeSub');
      cta = t('home.todayChallengeCta');
    }
  } else {
    eyebrow = t('home.todayStartEyebrow');
    title = t('home.todayStartTitle');
    sub = t('home.todayStartSub');
    cta = t('home.todayStartCta');
  }

  // 카드 전체를 누른다 — 카드 안에 따로 버튼을 두지 않는다(UX 가이드 5절, 10/23). 읽어 주는 이름은 갈 곳(cta), 설명은 제목.
  return (
    <Pressable
      ref={cardRef}
      onLayout={onCardLayout}
      collapsable={false}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={cta}
      accessibilityHint={title}
      ph-label="home_today_card"
      style={({ pressed }) => [styles.todayCard, pressed && styles.pressed]}>
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
      <View style={styles.todaySpacer} />
      {/* 버튼 모양이 아니라 카드가 어디로 가는지 알려 주는 글자 줄이다 — 누르는 곳은 카드 전체. */}
      <View style={styles.todayCta}>
        <Text style={styles.todayCtaText}>{cta}</Text>
        <Feather name="arrow-right" size={16} color={palette.onAccent} />
      </View>
    </Pressable>
  );
}

/**
 * 첫 사용자 홈의 선택 카드(pen P1.12~P1.14) — 안 골랐을 땐 회색 카드(모서리 16)에 흰 아이콘 칸·제목 18/700·설명 14·오른쪽 빈 라디오.
 * 고르면 옅은 파랑 바탕·파란 테두리·파란 제목에 라디오가 파랗게 차고, 카드 안에 「이렇게 진행돼요」 세 단계가 펼쳐진다(`steps`가 있을 때).
 * 첫 항목을 미리 골라 두고(10/23), 아래 「다음」을 눌러야 넘어간다.
 */
function FirstChoice({
  icon,
  title,
  sub,
  steps,
  selected,
  phLabel,
  onPress,
  targetRef,
  onLayout,
}: {
  icon: ComponentProps<typeof Feather>['name'];
  title: string;
  sub: string;
  steps?: string[];
  selected: boolean;
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
      style={({ pressed }) => [styles.choice, selected && styles.choiceOn, pressed && !selected && styles.pressed]}>
      <View style={styles.choiceTop}>
        <View style={styles.choiceIcon}>
          <Feather name={icon} size={20} color={palette.blue} />
        </View>
        <View style={styles.flex}>
          <Text style={[styles.choiceText, selected && styles.choiceTextOn]}>{title}</Text>
          <Text style={styles.choiceSub}>{sub}</Text>
        </View>
        <View style={[styles.radio, selected && styles.radioOn]}>
          {selected ? <Feather name="check" size={14} color={palette.onAccent} /> : null}
        </View>
      </View>
      {selected && steps && steps.length > 0 ? (
        <View style={styles.steps}>
          <Text style={styles.stepsTitle}>{t('home.firstStepsLabel')}</Text>
          {steps.map((text, i) => (
            <View key={i} style={styles.stepRow}>
              <View style={styles.stepNum}>
                <Text style={styles.stepNumText}>{i + 1}</Text>
              </View>
              <Text style={styles.stepText}>{text}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </Pressable>
  );
}

/** 홈 뼈대(SOMA-828) — 인사말, 이번 주 연습 칸, 추천 카드, 아래 목록 순서로 실제 홈 배치를 따른다. */
function HomeSkeleton() {
  return (
    <SkeletonGroup style={styles.skeleton}>
      <View style={styles.skeletonHero}>
        <SkeletonBlock width="58%" height={28} radius={radius.sm} />
        <SkeletonBlock width="44%" height={28} radius={radius.sm} />
        <SkeletonBlock width="50%" height={13} style={styles.skeletonGap} />
      </View>
      <View style={styles.skeletonCard}>
        <SkeletonBlock width="36%" height={16} />
        <View style={styles.week}>
          {Array.from({ length: 7 }, (_, i) => (
            <SkeletonBlock key={i} width={36} height={36} radius={radius.full} />
          ))}
        </View>
      </View>
      <SkeletonBlock height={164} radius={radius.lg} />
      <SkeletonBlock width="40%" height={16} style={styles.skeletonGap} />
      <SkeletonBlock height={75} radius={radius.lg} />
      <SkeletonBlock height={75} radius={radius.lg} />
    </SkeletonGroup>
  );
}

/** 홈 위 배경 — 위에서 아래로 옅어지는 파랑(예전 배경, SOMA-923). */
const HERO_FADE = ['#E4EEFC', '#E6EFFC', '#E9F1FD', '#ECF3FD', '#EFF5FD', '#F2F7FE', '#F5F9FE', '#F7FAFE'];

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  safeHero: { backgroundColor: '#E4EEFC' },
  scrollBg: { backgroundColor: '#F7FAFE' },
  heroBg: { position: 'absolute', top: 0, left: 0, right: 0, height: 250 },
  overscrollFill: { position: 'absolute', top: -1000, left: 0, right: 0, height: 1000, backgroundColor: '#E4EEFC' },
  heroWindow: { position: 'absolute', top: 0, left: 0, width: 440, height: 265, opacity: 0.9 },
  skeleton: { flex: 1, gap: space[3], paddingHorizontal: space.gutter, paddingTop: space[3], backgroundColor: palette.bg },
  skeletonHero: { gap: space[2], paddingBottom: space[4] },
  skeletonGap: { marginTop: space[1.5] },
  skeletonCard: { gap: space[3], padding: space[4], borderRadius: radius.lg, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.bg },
  flex: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.85 },

  // 첫 사용자 홈
  firstContainer: { paddingTop: space[8], paddingHorizontal: space.gutter, paddingBottom: space[6] },
  firstQuestion: { gap: space[1], paddingTop: space[8] },
  firstQuestionTitle: { ...type.title2, color: palette.text },
  firstQuestionSub: { ...type.caption, color: palette.textMeta },
  firstChoices: { gap: space[3], paddingTop: space[4] },
  firstFooter: { paddingHorizontal: space.gutter, paddingTop: space[2] },
  choice: {
    gap: space[3],
    paddingVertical: space[5],
    paddingHorizontal: space[4],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.bg,
  },
  choiceOn: { backgroundColor: palette.blueSoft, borderColor: palette.blue, borderWidth: 1.5 },
  choiceTop: { flexDirection: 'row', alignItems: 'flex-start', gap: space[3] },
  choiceIcon: { width: 40, height: 40, borderRadius: radius.full, backgroundColor: palette.blueSoft, alignItems: 'center', justifyContent: 'center' },
  choiceText: { ...type.body1Bold, color: palette.text },
  choiceTextOn: { color: palette.blueDeep },
  choiceSub: { marginTop: space[1], ...type.body2, color: palette.textSub },
  radio: { width: 22, height: 22, borderRadius: radius.full, borderWidth: 1.5, borderColor: palette.border, backgroundColor: palette.bg, alignItems: 'center', justifyContent: 'center' },
  radioOn: { backgroundColor: palette.blue, borderColor: palette.blue },
  steps: { gap: space[2], paddingTop: space[3], borderTopWidth: 1, borderTopColor: palette.border },
  stepsTitle: { ...type.captionBold, color: palette.blueDeep },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  stepNum: { width: 20, height: 20, borderRadius: radius.full, backgroundColor: palette.bg, alignItems: 'center', justifyContent: 'center' },
  stepNumText: { ...type.micro, color: palette.blueDeep },
  stepText: { flex: 1, ...type.body2, color: palette.text },

  heroBand: {
    paddingHorizontal: space.gutter,
    paddingBottom: space[3],
    gap: space[2],
  },
  hero: { height: 180 },
  heroText: { position: 'absolute', top: space[6], left: 0, width: 190, gap: space[2] },
  heroTitle: { ...type.display, color: palette.text },
  heroSub: { ...type.body2, color: palette.textSub },
  heroActy: { position: 'absolute', top: space[6], right: -space[1], width: 170, height: 156 },
  body: { paddingHorizontal: space.gutter, paddingTop: space[6], gap: space[4] },
  streakPill: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  streakText: { ...type.captionBold, color: palette.text },
  bell: {
    position: 'absolute',
    top: 0,
    right: -space[2],
    width: 44,
    height: 44,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bellDot: {
    position: 'absolute',
    top: 10,
    right: 11,
    width: 8,
    height: 8,
    borderRadius: radius.full,
    backgroundColor: palette.danger,
    borderWidth: 1.5,
    borderColor: palette.bg,
  },

  weekCard: {
    marginTop: space[3],
    backgroundColor: palette.bg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.border,
    padding: space[4],
    gap: space[3],
  },
  weekHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  weekTitle: { ...type.headline, color: palette.text },
  week: { flexDirection: 'row', justifyContent: 'space-between' },
  weekCol: { alignItems: 'center', gap: space[1.5], width: 40 },
  weekDot: { width: 36, height: 36, borderRadius: radius.full, backgroundColor: palette.bgSoft, alignItems: 'center', justifyContent: 'center' },
  weekDotDone: { backgroundColor: palette.blue },
  weekDotToday: { backgroundColor: palette.bg, borderWidth: 1.5, borderColor: palette.blue },
  weekLabel: { ...type.micro, color: palette.textMeta },
  weekLabelToday: { color: palette.text },

  todayCard: {
    backgroundColor: palette.text,
    borderRadius: radius.lg,
    padding: space[5],
    gap: space[2],
  },
  eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: space[1.5] },
  eyebrow: { ...type.caption, color: palette.onMediaSub },
  todayTitle: { ...type.title2, color: palette.onAccent },
  todaySub: { ...type.caption, color: palette.onMediaSub },
  todaySpacer: { height: space[2] },
  todayCta: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: space[1.5] },
  todayCtaText: { ...type.body2Bold, color: palette.onAccent },

  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: space[2] },
  sectionTitle: { ...type.headline, color: palette.text },
  sectionAll: { ...type.captionBold, color: palette.blueDeep },
  rowList: { gap: space[3] },
  deadlineList: { gap: space[2] },
  deadlineBlock: { gap: space[3] },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    padding: space[4],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.bg,
  },
  rowIcon: { width: 40, height: 40, borderRadius: radius.md, backgroundColor: palette.blueSoft, alignItems: 'center', justifyContent: 'center' },
  rowIconOrange: { backgroundColor: palette.flameSoft },
  listTitle: { ...type.body1Bold, color: palette.text },
  listMeta: { marginTop: space[1] / 2, ...type.caption, color: palette.textMeta },
  deadlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    padding: space[4],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.bg,
  },
  dday: { minWidth: 52, height: 24, paddingHorizontal: space[2], borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  ddayText: type.micro,
});
