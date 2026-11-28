import Feather from '@expo/vector-icons/Feather';
import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ComponentProps, type ReactNode, type Ref } from 'react';
import { BackHandler, type LayoutChangeEvent, Linking, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, ToastAndroid, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AdSlot } from '@/components/ad-slot';
import { AD_SIZES, AD_SLOTS } from '@/lib/ads';
import { BandGradient } from '@/components/ui/band-gradient';
import { PrimaryButton } from '@/components/ui/buttons';
import { useTabBarSpace } from '@/components/ui/tab-bar';
import { MASCOT } from '@/components/ui/mascot';
import { MascotBubble } from '@/components/ui/mascot-bubble';
import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';
import { api } from '@/lib/api';
import { logEvent } from '@/lib/analytics';
import { boardFailure, type CommunityPost } from '@/lib/community';
import { seedCommunityPost } from '@/lib/community-post-seed';
import { HOME_BOARD_PAGE } from '@/lib/home-board';
import { buildRecentActivity, withPracticeCounts } from '@/lib/practice-activity';
import { practiceHref, type PracticeMode } from '@/lib/practice-mode';
import { practiceDayTotal, practiceStreak } from '@/lib/practice/groups';
import type { PracticeGroup } from '@/lib/practice/types';
import { rememberPracticeDays, serverPracticeDayRecords, sessionPracticeDays, subscribeSessionPracticeDays } from '@/lib/practice-days';
import { countedPractices, type CountedPractice } from '@/lib/practice/counted';
import { skipsHomeGuide } from '@/lib/returning-account';
import { hasSeenSpotlight, hasSeenTutorial, markSpotlightSeen, markTutorialSeen } from '@/lib/guide-state';
import { kstDate, urgentAuditions, type AuditionPostingList } from '@/lib/auditions';
import { upcomingNotices, type AdmissionsResponse } from '@/lib/admissions';
import { isKorean, translate as t, translateList } from '@/lib/i18n';
import { firstTimeStateFrom, setFirstTimeState, shouldRememberGraduation, subscribeFirstTimeState } from '@/lib/practice/first-time';
import { rememberSkeletonHints, useSkeletonHints } from '@/lib/skeleton-hint';
import { currentFirstUseOwner, graduatedInMemory, hasGraduatedFirstUse, markFirstUseGraduated } from '@/lib/practice/first-use-graduation';
import type { ScriptCard } from '@/lib/reading/types';
import { SpotlightGuide, type SpotlightStep } from '@/components/spotlight-guide';
import { StreakCelebrationScreen } from '@/components/streak-celebration-screen';
import { AnnouncementPoster } from '@/components/announcement-poster';
import { HomeBoard, HomeBoardSkeleton, type HomeBoardFrom, type HomeBoardState } from '@/components/home-board';
import { HomeHeroActy } from '@/components/home-hero-acty';
import { HomeUploadCard } from '@/components/home-upload-card';
import { WeekPracticeCard } from '@/components/week-practice-card';
import { HomePlanBadge } from '@/components/home-plan-badge';
import { useBillingMe } from '@/hooks/use-billing-me';
import { homePlan, settingsTarget } from '@/lib/billing';
import { useWaitingUpload } from '@/hooks/use-waiting-upload';
import { useAuth } from '@/lib/auth';
import { homeDeadlineSections } from '@/lib/home-sections';
import { afterHomeReady, markHomeReady } from '@/lib/launch-splash';
import { INSTAGRAM_HANDLE, INSTAGRAM_PROFILE_URL, SUPPORT_EMAIL } from '@/lib/contact-channels';
import { readHomeSnapshot, writeHomeSnapshot } from '@/lib/home-snapshot';
import { SkeletonBlock, SkeletonGroup, SkeletonLine } from '@/components/ui/skeleton';
import { useSpotlightTarget } from '@/hooks/use-spotlight-target';
import { useUnreadNotifications } from '@/hooks/use-unread-notifications';
import { TARGET } from '@/lib/spotlight-targets';
import {
  readLastSeenStreak,
  celebrationDots,
  streakCelebrationStep,
  kstToday,
  readLastSeenStreakDay,
  writeLastSeenStreak,
} from '@/lib/streak-celebration';

/** 첫 사용자 홈에서 고른 길 → 「계속하기」가 여는 연습 탭의 쪽. 챌린지는 첫 연습을 끝낸 뒤에 보인다(SOMA-827) — 코칭·리딩 둘만. */
type FirstPick = PracticeMode;

/** 안드로이드 뒤로가기를 이 시간 안에 한 번 더 누르면 앱을 닫는다. */
const EXIT_BACK_WINDOW_MS = 2000;

/**
 * 첫 연습을 끝낸 뒤 홈에서 한 번 비추는 자리(pen 「첫 연습 끝 홈 · 안내 1/4~4/4」, SOMA-748) — 연습 탭(다음 연습을 이어 하는 곳),
 * 그다음 리딩 안내(같은 연습 탭)·챌린지·프로필 탭. 홈에서 오늘 할 것 카드를 뺐으므로(게시판 홈) 첫 단계도 연습 탭을 비춘다.
 * 첫 사용자 홈(뭐부터 해 볼까요?)에서는 띄우지 않는다.
 */
const HOME_STEPS: SpotlightStep[] = [
  { target: TARGET.tabReading, text: 'guide.spotFirstDone', round: true, mascot: 'home' },
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

/** 첫 사용자인지 따질 때만 더 보는 대본 — 14일보다 전에 읽은 것, 최근에 읽은 순으로 몇 개만(11/2). */
const OLDER_READING_CHECK_LIMIT = 10;
function olderPracticedScripts(scripts: readonly ScriptCard[], now = Date.now()): ScriptCard[] {
  return scripts
    .filter((s) => {
      const at = Date.parse(s.last_practiced_at ?? '');
      return Number.isFinite(at) && now - at > READING_LOOKBACK_MS;
    })
    .sort((a, b) => Date.parse(b.last_practiced_at ?? '') - Date.parse(a.last_practiced_at ?? ''))
    .slice(0, OLDER_READING_CHECK_LIMIT);
}

/**
 * A1. 홈(pen 일반 홈 BTT6at·SSeGm·gVzpd, 첫 사용자 홈 bHxn1I, SOMA-748).
 * 첫 연습 전이면 인사·소개 말풍선과 「뭐부터 해 볼까요?」 선택 카드(고르면 펼쳐지고 「계속하기」로 들어간다), 그 뒤로는 히어로(인사·액티·이번 주 연습) +
 * 광고 칸 + (올리는 중이면 올리는 카드) + 게시판·인기 글(components/home-board) + 마감 임박(app.audition) + 팀 연락처다.
 * 리딩·코칭 이어 하기는 연습 탭 맨 위에 있어 홈에 두지 않는다.
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
  /** 이번에 서버에서 홈 기록을 새로 받았나 — 받았으면 기기에 남긴 지난번 홈으로 덮지 않는다. */
  const freshRecords = useRef(false);
  // 묶음을 한 번이라도 받아 봤는지(실패도 받은 셈) — 받기 전엔 첫 사용자 화면을 함부로 띄우지 않는다.
  const [groupsLoaded, setGroupsLoaded] = useState(false);
  const [groupsFailed, setGroupsFailed] = useState(false);
  // 대본 목록·리딩 회차·참여작 중 못 받은 것이 있다 — 그러면 첫 사용자로 보지 않는다(11/2).
  const [recordsFailed, setRecordsFailed] = useState(false);
  const [scripts, setScripts] = useState<ScriptCard[] | null>(null);
  // 게시판 첫 쪽 — 「게시판」·「인기 글」 두 구역이 같이 쓴다(components/home-board). 홈이 보일 때와 당길 때 다시 받는다.
  const [board, setBoard] = useState<HomeBoardState>(null);
  const boardRequest = useRef(0);
  const loadBoard = useCallback(async () => {
    const id = ++boardRequest.current;
    try {
      const r = await api.communityPosts({ limit: HOME_BOARD_PAGE });
      if (id === boardRequest.current) setBoard({ posts: r.posts });
    } catch (e) {
      if (id === boardRequest.current) setBoard({ failure: boardFailure(e) });
    }
  }, []);
  // 연속일·주간 원용 날짜 — 서버 기록 ∪ 기기에 누적된 연습일(지워도 남는다).
  // null 이면 기록을 아직 한 번도 못 받은 것이다 — 그때의 연속일(0)로 축하를 판단하면 안 된다.
  const [activityDays, setActivityDays] = useState<{ created_at: string }[] | null>(null);
  /** 이 기기에서 리딩·코칭을 끝까지 해 본 계정인가(SOMA-827). 읽기 전엔 null — 첫 사용자 화면을 함부로 띄우지 않는다. */
  const [graduated, setGraduated] = useState<boolean | null>(null);
  // 주 기능 판단용 — 센 연습(코칭·리딩·챌린지) 목록.
  const [practices, setPractices] = useState<CountedPractice[]>([]);
  const [auditions, setAuditions] = useState<AuditionPostingList | null>(null);
  const [admissions, setAdmissions] = useState<AdmissionsResponse | null>(null);
  const [celebrateStreak, setCelebrateStreak] = useState<number | null>(null);
  // 불꽃 축하를 따져 본 연속일 — 따지기 전에는 「첫 연습 끝!」 안내를 띄우지 않는다(11/2 QA: 안내가 먼저 떠 축하가 다음 방문으로 밀렸다).
  const [streakCheckedFor, setStreakCheckedFor] = useState<number | null>(null);
  // 처음 한 번만 가이드 — 누를 자리를 비춰 준다.
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
  // 코칭 끝·리딩 끝 화면이 졸업을 적으면 뒤에 숨은 홈도 바로 다시 그린다(SOMA-1075). 탭바 모양(useTabBarSpace)이 바뀌어
  // 우연히 다시 그려지는 데 기대지 않고 졸업 신호를 직접 듣는다. 같은 신호를 탭바도 듣는다.
  const graduatedSignal = useSyncExternalStore(subscribeFirstTimeState, () => graduatedInMemory(meId));
  // 이번 실행에서 막 끝낸 코칭의 날(코칭 끝 화면이 노트를 확인하고 적는다) — 서버 기록을 다시 받기 전에도 연속일에 센다.
  const sessionDays = useSyncExternalStore(subscribeSessionPracticeDays, () => sessionPracticeDays(meId));
  // 홈이 보이는지 — 숨어 있을 때(코칭 끝 화면 뒤) 불꽃 축하를 따지면 보지 못한 축하를 본 것으로 남긴다.
  const [focused, setFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
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

  // 마지막 기록 읽기 — 이 계정으로 다 받았으면 true. 게이트가 열릴 때 다시 읽을지 정한다(아래 gateOpen).
  const recordsRead = useRef<Promise<boolean>>(Promise.resolve(false));
  // 기록(연습 묶음·대본·리딩 회차·참여작)을 읽는다. 화면에 들어올 때와 맨 위에서 당길 때 같이 쓴다 —
  // 당길 때는 첫 안내를 다시 띄우지 않도록 이 부분만 다시 부른다.
  const loadRecords = useCallback((isCancelled: () => boolean) => {
    let groupsOk = true;
    const groupsRead = api
      .listPracticeGroups('all')
      .then((r) => {
        if (isCancelled()) return r.groups;
        setGroups(r.groups);
        setGroupsFailed(false);
        setGroupsLoaded(true);
        return r.groups;
      })
      .catch(() => {
        groupsOk = false;
        if (!isCancelled()) {
          setGroups([]);
          setGroupsFailed(true);
          setGroupsLoaded(true);
        }
        return [] as PracticeGroup[];
      });
    // 오늘 할 것의 리딩 후보 — 이어 읽을 대본. 실패하면 리딩 후보만 빠진다.
    let readFailed = false;
    const scriptsRead = Promise.resolve()
      .then(() => api.listReadingScripts())
      .then((r) => {
        if (!isCancelled()) setScripts(r.scripts);
        return r.scripts;
      })
      .catch(() => {
        readFailed = true;
        if (!isCancelled()) setScripts([]);
        return [] as ScriptCard[];
      });
    const sessionsOf = (s: ScriptCard) =>
      api
        .listReadingSessions(s.id)
        .then((x) => x.sessions)
        .catch(() => {
          readFailed = true;
          return [];
        });
    // 연속일·주간 원·「첫 연습 끝!」은 「연습 1회」 기준 하나로 센다(SOMA-773) — 노트가 생긴 코칭 회차, 끝까지 읽은
    // 리딩 회차, 올린 참여작. 리딩 회차는 대본별로만 받으므로 최근에 연습한 대본만 읽는다(지난 날은 기기에 쌓여 있다).
    const readingRead = scriptsRead
      .then((list) => Promise.all(recentlyPracticedScripts(list).map(sessionsOf)))
      .then((lists) => lists.flat())
      .catch(() => []);
    const entriesRead = Promise.resolve()
      .then(() => api.listMyChallengeEntries())
      .then((r) => r.entries)
      .catch(() => {
        readFailed = true;
        return [];
      });
    // 서버가 센 연습일 전체(SOMA-1003) — 리딩은 위에서 최근 대본만 읽으니, 재설치·새 로그인 뒤에도 지난 날이 빠지지 않게
    // 함께 쓴다. 실패하면 지금처럼 위 기록과 기기 누적분만 쓴다(구역을 비우지 않는다).
    const serverDaysRead = Promise.resolve()
      .then(() => api.practiceDays())
      .then((r) => r.days)
      .catch(() => [] as string[]);
    const run = Promise.all([groupsRead, scriptsRead, readingRead, entriesRead, serverDaysRead]).then(async ([groupList, scriptList, readingSessions, entries, serverDays]) => {
      // 화면을 떠난 뒤 온 응답은 버린다 — 기기에 쌓지도 않는다.
      if (isCancelled()) return;
      // 연습한 날은 기기에도 쌓아 둔다 — 기록을 숨겨도 "그 날 연습했다"는 사실은 남는다.
      const counted = countedPractices({ groups: groupList, readingSessions, entries });
      setPractices(counted);
      // 최근 연습이 하나도 안 보이면 14일보다 전에 읽은 대본도 본다 — 오래전에 끝까지 읽은 사람을 첫 사용자로 보지 않게(11/2).
      // 찾으면 졸업 표시를 남겨 다음부터는 다시 따지지 않는다. 불꽃·주간 원은 그대로 최근 기록만 쓴다.
      if (counted.length === 0) {
        const older = olderPracticedScripts(scriptList);
        if (older.length > 0) {
          const olderSessions = (await Promise.all(older.map(sessionsOf))).flat();
          if (isCancelled()) return;
          if (countedPractices({ readingSessions: olderSessions }).length > 0) {
            const owner = currentFirstUseOwner();
            await markFirstUseGraduated(owner);
            if (isCancelled()) return;
            if (owner) setGraduated(true);
          }
        }
      }
      setRecordsFailed(readFailed);
      const records = [...counted.map((p) => ({ created_at: p.at })), ...serverPracticeDayRecords(serverDays)];
      const owner = currentFirstUseOwner();
      return rememberPracticeDays(records, owner).then((days) => {
        if (isCancelled()) return;
        freshRecords.current = true;
        setActivityDays(days);
        // 다음에 앱을 켤 때 이 홈을 먼저 그린다(lib/home-snapshot). 받기에 실패한 갈래가 있으면 남기지 않는다.
        if (owner && !readFailed) {
          void writeHomeSnapshot({
            owner,
            groups: groupList,
            scripts: scriptList,
            practices: counted,
            activityDays: days,
            enteredChallengeIds: entries.flatMap((entry) => (entry.challenge?.id ? [entry.challenge.id] : [])),
          });
        }
      });
    }).then(
      () => !isCancelled() && groupsOk && !readFailed && currentFirstUseOwner() !== null,
      () => false,
    );
    recordsRead.current = run;
    return run;
  }, []);
  const homeFocused = useRef(false);
  const [refreshing, setRefreshing] = useState(false);
  const refreshRecords = useCallback(async () => {
    setRefreshing(true);
    setGraduationCheck((n) => n + 1);
    try {
      await Promise.all([loadRecords(() => !homeFocused.current), loadBoard()]);
    } finally {
      setRefreshing(false);
    }
  }, [loadRecords, loadBoard]);

  useFocusEffect(
    useCallback(() => {
      // 올 때마다 본 적 있는지 묻는다(기기에서 읽는 값이라 싸다). 한 번만 묻고 말면,
      // 설정에서 되살린 뒤 앱을 껐다 켜야 보인다 — 실기기에서 그렇게 걸렸다.
      guideFocused.current = true;
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
      homeFocused.current = true;
      void loadRecords(() => cancelled);
      void loadBoard();
      return () => {
        cancelled = true;
        homeFocused.current = false;
        // 떠나면 닫는다 — 설정에 다녀오면 다시 묻고 연다.
        guideFocused.current = false;
        setGuideOpen(false);
      };
    }, [openHomeGuideIfNew, loadRecords, loadBoard]),
  );

  // 오프라인으로 켜면 홈이 동의 팝업 뒤에서 기록을 먼저 읽고 실패한 채 남는다. 동의·프로필을 다시 읽어 게이트가
  // 열리는 순간 홈에 있으면 기록을 한 번 더 읽는다 — 이번 주 칸·이어 읽기·참여 표시가 비어 있던 것(11/2 폰 QA).
  const gateOpen = consentAllowed && profile.status === 'complete';
  const gateWasOpen = useRef(gateOpen);
  useEffect(() => {
    const opened = gateOpen && !gateWasOpen.current;
    gateWasOpen.current = gateOpen;
    if (!opened) return;
    // 게이트 전에 읽은 기록을 이 계정으로 다 받았으면 다시 읽지 않는다 — 앱을 켤 때마다 같은 기록을 두 번 받았다(11/3 측정).
    // 받는 중이면 끝나기를 기다린다.
    let stale = false;
    void recordsRead.current.then((ok) => {
      if (ok || stale) return;
      // 로그인 전·게이트 전에 읽은(실패했거나 계정을 모르고 센) 기록은 버리고 뼈대로 돌린다 — 로그인 직후 「이번 주 연습」이
      // 빈 칸으로 보였다가 나중에 채워지던 것(11/2 폰 QA). 지금 홈에 있으면 바로 다시 읽고, 아니면 홈에 올 때 읽는다.
      freshRecords.current = false;
      setActivityDays(null);
      if (homeFocused.current) void loadRecords(() => !homeFocused.current);
    });
    return () => {
      stale = true;
    };
  }, [gateOpen, loadRecords]);

  // 앱을 켤 때 지난번 홈(같은 계정, 7일 안)을 먼저 그린다 — 로고를 홈 기록 받기까지 붙잡지 않는다(11/3 폰 QA: 켜는 데 4~6초).
  // 새 답이 먼저 왔으면 쓰지 않는다. 새 답이 오면 칸만 바뀐다.
  const snapshotOwner = gateOpen ? (user?.id ?? null) : null;
  useEffect(() => {
    if (!snapshotOwner) return;
    let live = true;
    void readHomeSnapshot<PracticeGroup, ScriptCard, CountedPractice>(snapshotOwner).then((snap) => {
      if (!live || !snap || freshRecords.current) return;
      setGroups(snap.groups);
      setGroupsFailed(false);
      setGroupsLoaded(true);
      setScripts(snap.scripts);
      setPractices(snap.practices);
      setActivityDays(snap.activityDays);
    });
    return () => {
      live = false;
    };
  }, [snapshotOwner]);

  useEffect(() => {
    // 한국어를 안 쓰는 사람에겐 보여줄 자리가 없으니 받아오지도 않는다 (SOMA-544).
    if (!isKorean()) return;
    let cancelled = false;
    // 오디션 공고는 한국 공고뿐이고(app.audition) 하루 두 번 바뀐다 — 입시와 같이 홈을 열 때 한 번만 읽는다.
    // 홈 첫 화면에 필요한 기록을 다 받은 뒤에 부른다(lib/launch-splash afterHomeReady).
    afterHomeReady()
      .then(() => (cancelled ? null : api.auditions()))
      .then((data) => {
        if (data === null) return;
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


  // 화면에 그리는 연습한 날 — 받은 기록에 이번 실행에서 막 끝낸 코칭의 날을 더한다. 기기 누적분에는 넣지 않는다(SOMA-1075).
  const shownDays = useMemo(
    () => (activityDays && sessionDays.length > 0 ? [...activityDays, ...sessionDays] : activityDays),
    [activityDays, sessionDays],
  );
  // 오늘이 맨 오른쪽인 최근 7일.
  const { days } = useMemo(() => buildRecentActivity(shownDays ?? []), [shownDays]);
  // 「이번 주 연습」 원에 쓰는 날마다 횟수 — 연습한 날은 최소 1, 그 날 센 연습(코칭·리딩·챌린지)이 더 많으면 그 수.
  const weekDays = useMemo(() => withPracticeCounts(days, practices), [days, practices]);
  const weekPracticedDays = weekDays.filter((d) => d.count > 0).length;
  // 연속 연습 일수는 회차 시작 날짜를 한국 시간으로 센다(practice.library).
  const streak = useMemo(() => practiceStreak((shownDays ?? []).map((d) => d.created_at)), [shownDays]);
  // 누적 연습일(SOMA-1003) — 연속이 끊겨도 줄지 않는 숫자. 같은 날 여러 번 해도 하루다.
  const totalDays = useMemo(() => practiceDayTotal((shownDays ?? []).map((d) => d.created_at)), [shownDays]);
  const activityLoaded = shownDays !== null;
  // 「첫 연습 끝!」 안내는 연습 1회(노트 생긴 코칭·끝낸 리딩·올린 참여작)를 한 뒤에만 띄운다(SOMA-773).
  const practiced = (shownDays?.length ?? 0) > 0;

  // 연속일이 오늘 늘었으면(마지막으로 본 값보다 크면) 딱 한 번 축하한다 (SOMA-479).
  // 기록을 받기 전엔 판단하지 않는다 — 그 판정은 streakCelebrationStep 이 한다(SOMA-494).
  // 오늘 연습이 없으면 축하하지 않는다 — 앱을 새로 깔아 저장값이 0 이 돼도 어제까지의 연속일로 다시 뜨지 않게.
  const practicedToday = days.some((d) => d.isToday && d.count > 0);
  useEffect(() => {
    if (!focused) return;
    let cancelled = false;
    void Promise.all([readLastSeenStreak(), readLastSeenStreakDay()]).then(([lastSeen, lastSeenDay]) => {
      if (cancelled) return;
      const step = streakCelebrationStep({
        loaded: activityLoaded,
        lastSeen,
        current: streak,
        practicedToday,
        failed: recordsFailed,
        lastSeenDay,
        today: kstToday(),
      });
      if (step.celebrate) setCelebrateStreak(streak);
      if (step.remember !== null) void writeLastSeenStreak(step.remember);
      if (activityLoaded) setStreakCheckedFor(streak);
    });
    return () => {
      cancelled = true;
    };
  }, [focused, activityLoaded, streak, practicedToday, recordsFailed]);

  // 방금 끝낸 연습으로 졸업했으면 저장값을 다시 읽기 전에도 안다 — 첫 사용자 홈이 잠깐 보이지 않게(11/2 QA).
  const graduatedNow = graduated === true || graduatedSignal;
  const loaded = groupsLoaded && scripts !== null && activityLoaded && (graduated !== null || graduatedNow);
  // 첫 사용자 화면(뭐부터 해 볼까요?)은 다른 탭과 같은 판단 하나를 쓴다(lib/practice/first-time) — 묶음·대본·연습한 날이 모두 없는 사람.
  // 묶음을 못 받았으면 첫 사용자로 보지 않는다 — 시작한 사람에게 첫 화면을 보이는 쪽이 더 이상하다.
  const firstTime = firstTimeStateFrom({
    loaded,
    groupsFailed,
    recordsFailed,
    groups,
    scripts: scripts ?? [],
    practicedDays: shownDays?.length ?? 0,
    graduated: graduatedNow,
  });
  const firstUser = firstTime === 'first';

  // 첫 사용자인지 한 곳에 적고 연습 탭(리딩·코칭 첫 화면)이 읽는다. 홈을 떠나도 지우지 않는다.
  // 연습 1회를 끝낸 뒤 홈에 오면 practiced 가 된다.
  useEffect(() => {
    setFirstTimeState(firstTime);
  }, [firstTime]);

  // 받기 전 화면은 이 기기에서 지난번에 실제로 그린 홈(lib/skeleton-hint)을 따른다.
  // - 첫 사용자 홈이었으면 기다리지 않고 실제 첫 사용자 홈을 바로 그린다. 고정 글뿐이라 받을 것이 없다.
  // - 기존 사용자 홈이었으면 같은 틀에 받는 칸만 회색인 뼈대를 그린다.
  // - 기억이 없으면(새로 깔았거나 로그아웃한 뒤) 짐작하지 않는다. 앱을 켤 때는 로고가 확인이 끝날 때까지 덮고,
  //   그보다 오래 걸릴 때만 첫 사용자 모양 뼈대가 보인다.
  const skeletonHints = useSkeletonHints();
  const showFirstHome = loaded ? firstUser : skeletonHints.home === 'first' && !graduatedNow;
  // 첫 데이터를 다 받았거나 첫 사용자 홈을 바로 그릴 수 있으면 앱을 켤 때 붙잡아 둔 로고를 닫게 한다.
  useEffect(() => {
    if (loaded || showFirstHome) markHomeReady();
  }, [loaded, showFirstHome]);
  useEffect(() => {
    if (firstTime === 'first') rememberSkeletonHints({ home: 'first' });
    else if (firstTime === 'practiced') rememberSkeletonHints({ home: 'returning' });
  }, [firstTime]);

  // 기록으로 첫 사용자를 벗어났으면 이 기기에 남긴다 — 다음에 서버 기록이 달라 보여도(다시 읽기 시작한 대본, 14일 지난 회차,
  // 못 받은 목록) 첫 사용자 홈으로 되돌아가지 않는다(11/2, 리딩하고 돌아오니 기존 홈이 첫 홈으로 바뀌었다).
  useEffect(() => {
    if (!meId || !shouldRememberGraduation(firstTime, graduated)) return;
    void markFirstUseGraduated(meId);
    setGraduated(true);
  }, [meId, firstTime, graduated]);

  const waitingUpload = useWaitingUpload();

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

  // 게시판 글 열기 — 커뮤니티 목록과 같이 받은 글을 먼저 넘겨 상세가 바로 그려지게 한다.
  const openBoardPost = (post: CommunityPost, from: Exclude<HomeBoardFrom, 'more'>) => {
    logEvent('home_board_open', { from });
    seedCommunityPost(post);
    router.push({ pathname: '/community-post', params: { id: post.id } });
  };
  const openBoardMore = () => {
    logEvent('home_board_open', { from: 'more' });
    router.push('/community');
  };
  const writeFirstPost = () => {
    logEvent('home_board_empty_write');
    router.push('/community-new');
  };

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


  // 지금 플랜(SOMA-981). 다시 받는 동안은 지난 값을 그대로 두고, 처음 받기 전·실패면 그리지 않는다.
  const billing = useBillingMe();
  const plan = homePlan(billing.me);
  const planBadge = (style: typeof styles.heroPlan) =>
    plan && billing.me ? <HomePlanBadge plan={plan} style={style} onPress={() => billing.me && router.push(settingsTarget(billing.me))} /> : null;

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

  // 기존 사용자 홈 위 띠(인사·액티·이번 주 연습). 뼈대 화면도 같은 띠를 그리고 이번 주 칸만 회색으로 둔다.
  const heroBand = (weekLoading: boolean) => (
    <View style={styles.heroBand}>
      {/* iOS 에서 위로 당기면(바운스) 히어로 위가 비어 스크롤 바탕색이 띠처럼 보였다 — 히어로 첫 색을 위로 길게 깐다(SOMA-924). */}
      <View style={styles.overscrollFill} pointerEvents="none" />
      <View style={styles.heroBg} pointerEvents="none">
        <BandGradient stops={HERO_STOPS} />
      </View>
      <Image source={require('@/assets/images/home/window-light.png')} style={styles.heroWindow} contentFit="cover" accessibilityIgnoresInvertColors />
      <View style={styles.hero}>
        <View style={styles.heroText}>
          <Text style={styles.heroTitle} accessibilityRole="header">{t('home.heroTitle')}</Text>
          <Text style={styles.heroSub}>{t('home.heroSub')}</Text>
        </View>
        {/* 책은 두고 액티만 폴짝 뛰고 숨 쉰다 — 누르면 다시 뛴다(components/home-hero-acty). */}
        <HomeHeroActy style={styles.heroActy} height={styles.heroActy.height} />
        {planBadge(styles.heroPlan)}
        {bell}
      </View>
      {/* 이번 주 연습 — 원이 그날 연습 횟수만큼 차오르는 공용 카드(components/week-practice-card). */}
      <View style={styles.weekWrap}>
        <WeekPracticeCard days={weekDays} practicedDays={weekPracticedDays} totalDays={totalDays} loading={weekLoading} />
      </View>
    </View>
  );

  // 불꽃 축하가 먼저, 「첫 연습 끝!」 안내는 그다음 — 축하를 따져 보기 전·축하 중에는 안내를 띄우지 않는다(11/2 QA).
  const guideVisible =
    guideOpen && overlaysReady && loaded && !firstUser && practiced && !skipsHomeGuide(practices.length) && streakCheckedFor === streak && celebrateStreak === null;
  return (
    <SafeAreaView style={[styles.safe, (loaded ? !firstUser : skeletonHints.home === 'returning') && styles.safeHero]} edges={['top']}>
      {celebrateStreak !== null && overlaysReady && !guideVisible && (
        <StreakCelebrationScreen
          streak={celebrateStreak}
          dots={celebrationDots(days)}
          onDone={() => setCelebrateStreak(null)}
        />
      )}
      {!showFirstHome && !loaded ? (
        // 앱을 켤 때는 로고가 이 자리를 덮고 있다(lib/launch-splash.ts). 서버가 느려 로고가 먼저 닫히면 뼈대 화면이 보인다(SOMA-828).
        <HomeSkeleton
          variant={skeletonHints.home === 'returning' ? 'returning' : 'first'}
          adSpace={skeletonHints.homeAd !== false ? AD_SIZES[AD_SLOTS.home_top.size].height : 0}
          heroBand={heroBand(true)}
          footerSpace={tabBarSpace}
        />
      ) : showFirstHome ? (
        // 첫 사용자 홈(pen P1.12 「뭐부터 해 볼까요?」) — 액티 말풍선 아래에서 하나를 고르면(회색 → 옅은 파랑) 아래 「다음」으로 그 탭에 들어간다.
        // 첫 줄(코칭)이 첫 가이드가 비추는 자리다.
        <View style={styles.flex}>
          <ScrollView contentContainerStyle={styles.firstContainer} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refreshRecords()} tintColor={palette.blue} />}>
            {/* 처음 온 사람에게 FREE·「Pro 알아보기」는 이르다(11/2 QA) — Pro 를 받은 사람만 PRO 를 보인다. */}
            {plan === 'pro' && planBadge(styles.firstPlan)}
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
                if (firstPick) router.push(practiceHref(firstPick));
              }}
            />
          </View>
        </View>
      ) : (
        <ScrollView
          style={styles.scrollBg}
          contentContainerStyle={{ paddingBottom: tabBarSpace + space[5] }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refreshRecords()} tintColor={palette.blue} />}>
          {/* 히어로(pen 「홈」) — 인사·책 읽는 액티·알림 버튼과 이번 주 연습 카드. */}
          {/* 요소·배치는 개편본, 배경은 흰색까지 옅어지는 파랑 띠와 창문 빛(SOMA-923). */}
          {heroBand(false)}

          <View style={styles.body}>
          {/* 지난번에 광고 칸이 비었으면 받기 전에 자리를 잡지 않고, 보였으면 뼈대에도 같은 자리를 둔다(11/3 폰 QA). */}
          <AdSlot
            slot="home_top"
            reserve={skeletonHints.homeAd !== false}
            onShownChange={(shown) => rememberSkeletonHints({ homeAd: shown })}
          />
          {/* 영상을 올리는 중이면 광고 칸 아래에 올리는 카드를 둔다. 리딩·코칭 이어 하기는 연습 탭 맨 위에 있다. */}
          {waitingUpload.card && <HomeUploadCard upload={waitingUpload} />}

          {/* 게시판(칸마다 최신 글 한 줄)·인기 글 — 게시판 첫 쪽 한 번으로 둘 다 그린다(components/home-board). */}
          <HomeBoard board={board} onOpen={openBoardPost} onMore={openBoardMore} onWrite={writeFirstPost} onRetry={() => void loadBoard()} />

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
          {/* 팀 연락처(11/3 사용자: 인스타·메일은 홈 맨 아래에만) — 인스타 계정을 누르면 프로필이 열린다. 메일은 글자만. */}
          <Text style={styles.contactFooter}>
            <Text
              style={styles.contactFooterLink}
              onPress={() => void Linking.openURL(INSTAGRAM_PROFILE_URL).catch(() => undefined)}
              accessibilityRole="link"
              accessibilityLabel={t('home.contactInstagramA11y', { handle: INSTAGRAM_HANDLE })}>
              {t('home.contactInstagram', { handle: INSTAGRAM_HANDLE })}
            </Text>
            {` · ${t('home.contactEmail', { email: SUPPORT_EMAIL })}`}
          </Text>
          </View>
        </ScrollView>
      )}

      <SpotlightGuide
        visible={guideVisible}
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

/** D-day 배지 — 3일 안은 danger, 그 밖은 파랑. 한 화면에 상태색은 하나만 쓴다. */
function ddayTone(days: number): { box: { backgroundColor: string }; text: { color: string } } {
  if (days <= 3) return { box: { backgroundColor: palette.dangerSoft }, text: { color: palette.danger } };
  return { box: { backgroundColor: palette.blueSoft }, text: { color: palette.blueDeep } };
}

/** 2026-10-26 → 10월 26일. */
function monthDay(date: string): string {
  const m = date.match(/^\d{4}-(\d{2})-(\d{2})/);
  return m ? t('home.monthDay', { m: Number(m[1]), d: Number(m[2]) }) : date;
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

/**
 * 홈 뼈대(SOMA-828). 실제 홈과 같은 틀을 그리고 서버에서 받는 칸만 회색으로 둔다.
 * - first: 첫 사용자 홈 「뭐부터 해 볼까요?」 — 액티 말풍선·질문은 고정 글이라 그대로, 고르는 카드 둘과 아래 버튼만 회색.
 * - returning: 기존 사용자 홈 — 위 띠(인사·액티·이번 주 연습 칸 회색)는 실제와 같고, 게시판 줄만 회색.
 */
function HomeSkeleton({
  variant,
  adSpace = 0,
  heroBand,
  footerSpace,
}: {
  variant: 'first' | 'returning';
  /** 실제 홈 맨 위 광고 칸 높이(dp). 0 이면 두지 않는다. */
  adSpace?: number;
  heroBand: ReactNode;
  footerSpace: number;
}) {
  if (variant === 'first') {
    return (
      <SkeletonGroup style={styles.flex}>
        <View style={[styles.flex, styles.firstContainer]}>
          <MascotBubble source={MASCOT.coach} title={t('home.firstHelloNoName')} guide={t('home.firstIntro')} />
          <View style={styles.firstQuestion}>
            <Text style={styles.firstQuestionTitle}>{t('home.firstQuestion')}</Text>
            <Text style={styles.firstQuestionSub}>{t('home.firstPickSub')}</Text>
          </View>
          <View style={styles.firstChoices}>
            <SkeletonChoice steps={3} />
            <SkeletonChoice />
          </View>
        </View>
        <View style={[styles.firstFooter, { paddingBottom: space[3] + footerSpace }]}>
          <SkeletonBlock height={48} radius={radius.lg} />
        </View>
      </SkeletonGroup>
    );
  }
  return (
    <SkeletonGroup style={styles.flex}>
      <ScrollView style={styles.scrollBg} contentContainerStyle={{ paddingBottom: footerSpace + space[5] }} scrollEnabled={false} showsVerticalScrollIndicator={false}>
        {heroBand}
        <View style={styles.body}>
          {adSpace > 0 && <View style={{ height: adSpace }} />}
          <HomeBoardSkeleton />
        </View>
      </ScrollView>
    </SkeletonGroup>
  );
}

/** 첫 사용자 홈 고르는 카드(FirstChoice) 자리 — 같은 틀(styles.choice)에 글만 회색. steps 가 있으면 펼친 카드다. */
function SkeletonChoice({ steps = 0 }: { steps?: number }) {
  return (
    <View style={styles.choice}>
      <View style={styles.choiceTop}>
        <SkeletonBlock width={40} height={40} radius={radius.full} />
        <View style={styles.flex}>
          <SkeletonLine size={type.body1Bold} width="62%" />
          <View style={{ marginTop: space[1] }}>
            <SkeletonLine size={type.body2} width="92%" />
            <SkeletonLine size={type.body2} width="48%" />
          </View>
        </View>
        <SkeletonBlock width={22} height={22} radius={radius.full} />
      </View>
      {steps > 0 && (
        <View style={styles.steps}>
          <SkeletonLine size={type.captionBold} width="30%" />
          {Array.from({ length: steps }, (_, i) => (
            <View key={i} style={styles.stepRow}>
              <SkeletonBlock width={20} height={20} radius={radius.full} />
              <SkeletonLine size={type.body2} width={i === 1 ? '58%' : '68%'} style={styles.flex} />
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

/** 홈 위 배경 — 위에서 아래로 흰색까지 옅어지는 파랑(디자인 시스템 「그라데이션 예외」). */
const HERO_STOPS = [
  [0, '#E4EEFC'],
  [1, palette.bg],
] as const;

const styles = StyleSheet.create({
  contactFooter: { ...type.caption, color: palette.textMeta, textAlign: 'center', marginTop: space[6] },
  contactFooterLink: { ...type.caption, color: palette.blueDeep },
  safe: { flex: 1, backgroundColor: palette.bg },
  safeHero: { backgroundColor: '#E4EEFC' },
  scrollBg: { backgroundColor: palette.bg },
  heroBg: { position: 'absolute', top: 0, left: 0, right: 0, height: 250 },
  overscrollFill: { position: 'absolute', top: -1000, left: 0, right: 0, height: 1000, backgroundColor: '#E4EEFC' },
  heroWindow: { position: 'absolute', top: 0, left: 0, width: 440, height: 265, opacity: 0.9 },
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
  radio: { width: 22, height: 22, borderRadius: radius.full, borderWidth: 1.5, borderColor: palette.textDisabled, backgroundColor: palette.bg, alignItems: 'center', justifyContent: 'center' },
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
  // 종(오른쪽 -8, 지름 44) 바로 왼쪽, 세로 가운데.
  heroPlan: { position: 'absolute', top: 8, right: 44 },
  firstPlan: { position: 'absolute', top: space[3], right: space.gutter },
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

  weekWrap: { marginTop: space[3] },

  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: space[2] },
  sectionTitle: { ...type.headline, color: palette.text },
  sectionAll: { ...type.body2Bold, color: palette.blueDeep },
  deadlineList: { gap: space[2] },
  deadlineBlock: { gap: space[3] },
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
