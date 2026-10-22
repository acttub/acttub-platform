import Feather from '@expo/vector-icons/Feather';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState, type ComponentProps, type Ref } from 'react';
import { ActivityIndicator, BackHandler, Platform, Pressable, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/ui/buttons';
import { useTabBarSpace } from '@/components/ui/tab-bar';
import { MASCOT, MASCOT_SIZE } from '@/components/ui/mascot';
import { MascotBubble } from '@/components/ui/mascot-bubble';
import { palette } from '@/constants/palette';
import { api } from '@/lib/api';
import { buildWeekActivity } from '@/lib/practice-activity';
import { practiceStreak, groupPoster, groupRowTarget, lastNotePracticeId, recentGroups, sceneTitle } from '@/lib/practice/groups';
import type { PracticeGroup } from '@/lib/practice/types';
import { continueActionFor } from '@/lib/practice/resume';
import { setContinueOrigin } from '@/lib/practice/session-state';
import { rememberPracticeDays } from '@/lib/practice-days';
import { countedPracticeDates } from '@/lib/practice/counted';
import { hasSeenSpotlight, hasSeenTutorial, markSpotlightSeen, markTutorialSeen } from '@/lib/guide-state';
import { currentTutorial } from '@/lib/tutorial';
import {
  localDate,
  upcomingNotices,
  type AdmissionsResponse,
} from '@/lib/admissions';
import { kstDate, urgentAuditions, type AuditionPostingList } from '@/lib/auditions';
import { dateLocale, isKorean, translate as t, translateList } from '@/lib/i18n';
import { firstTimeStateFrom, setFirstTimeState } from '@/lib/practice/first-time';
import { pickToday, tipIndex, type TodayItem } from '@/lib/home-today';
import type { ScriptCard, SessionProgress } from '@/lib/reading/types';
import type { ChallengeCard } from '@/lib/challenge/types';
import { loadIntoCurrent } from '@/lib/reading/store';
import { SpotlightGuide, type SpotlightStep } from '@/components/spotlight-guide';
import { finishTutorial } from '@/hooks/use-tutorial-spotlight';
import { StreakCelebrationScreen } from '@/components/streak-celebration-screen';
import { AnnouncementPoster } from '@/components/announcement-poster';
import { useAuth } from '@/lib/auth';
import { homeDeadlineSections } from '@/lib/home-sections';
import { useAppDialog } from '@/components/app-dialog';
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

const PREVIEW_COUNT = 3;

/** 첫 사용자 홈에서 고른 길 → 「계속하기」가 가는 탭(예전엔 카드를 누르면 바로 갔다). */
type FirstPick = 'coaching' | 'reading';
const FIRST_PICK_ROUTE: Record<FirstPick, '/coaching' | '/reading'> = {
  coaching: '/coaching',
  reading: '/reading',
};

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

function recentDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(dateLocale(), { month: 'long', day: 'numeric' });
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
  const [readingProgress, setReadingProgress] = useState<{ scriptId: string; progress: SessionProgress } | null>(null);
  const [featured, setFeatured] = useState<ChallengeCard | null>(null);
  // 연속일·주간 원용 날짜 — 서버 기록 ∪ 기기에 누적된 연습일(지워도 남는다).
  // null 이면 기록을 아직 한 번도 못 받은 것이다 — 그때의 연속일(0)로 축하를 판단하면 안 된다.
  const [activityDays, setActivityDays] = useState<{ created_at: string }[] | null>(null);
  const [admissions, setAdmissions] = useState<AdmissionsResponse | null>(null);
  const [auditions, setAuditions] = useState<AuditionPostingList | null>(null);
  const [celebrateStreak, setCelebrateStreak] = useState<number | null>(null);
  // 처음 한 번만 가이드 — 누를 자리를 비춰 준다. 설정의 "가이드 다시 보기"로 되살릴 수 있다.
  const [guideOpen, setGuideOpen] = useState(false);
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
      if (!seen) setGuideOpen(true);
      setGuideChecked(true);
    });
  }, []);

  useFocusEffect(
    useCallback(() => {
      // 올 때마다 본 적 있는지 묻는다(기기에서 읽는 값이라 싸다). 한 번만 묻고 말면,
      // 설정에서 되살린 뒤 앱을 껐다 켜야 보인다 — 실기기에서 그렇게 걸렸다.
      // 튜토리얼 중에 홈으로 돌아왔다면 루프를 벗어난 것이다 — 거기서 끝낸다.
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
        return rememberPracticeDays(countedPracticeDates({ groups: groupList, readingSessions, entries })).then((days) => {
          if (!cancelled) setActivityDays(days);
        });
      });
      return () => {
        cancelled = true;
      };
    }, [router, openHomeGuideIfNew]),
  );

  useEffect(() => {
    // 입시는 로그인과 무관하고 배포 때만 바뀐다 — 포커스마다 다시 읽지 않는다.
    // 한국어를 안 쓰는 사람에겐 보여줄 자리가 없으니 받아오지도 않는다 (SOMA-544).
    if (!isKorean()) return;
    let cancelled = false;
    api
      .admissions()
      .then((data) => {
        if (!cancelled) setAdmissions(data);
      })
      .catch(() => {
        if (!cancelled) setAdmissions(null);
      });
    // 오디션 공고도 한국 공고뿐이고(app.audition) 하루 두 번 바뀐다 — 입시와 같이 홈을 열 때 한 번만 읽는다.
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

  // 연기 입시는 한국 대학 일정이라 한국어로 쓰는 사람에게만 쓸모가 있다 (SOMA-544).
  const deadlines = useMemo(
    () => (admissions && isKorean() ? upcomingNotices(admissions, localDate(), 2) : []),
    [admissions],
  );
  // 입시생(만 19세 이하)은 입시만, 만 20세 이상 입시생은 둘 다, 나머지는 오디션만 본다(SOMA-654).
  const sections = homeDeadlineSections(profile.me?.profile, kstDate());
  // 마감일이 있는 공고 중 가까운 둘. 비면(기능 꺼짐·공고 없음) 칸째 숨긴다.
  const auditionDeadlines = useMemo(
    () => (auditions && isKorean() ? urgentAuditions(auditions.items, kstDate(), 2) : []),
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

  // 홈의 최근 연습은 숨기지 않은 묶음 3개다.
  const recent = useMemo(() => recentGroups(groups, PREVIEW_COUNT), [groups]);

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

  const today = useMemo(
    () => pickToday({ groups, scripts: scripts ?? [], challenge: featured, now: new Date() }),
    [groups, scripts, featured],
  );

  // 「다음에 해 볼 것」(노트의 다음 테이크 문장) — 코칭 숙제와 최근 연습 줄에 쓴다. 목록에 없어 노트를 따로 읽는다.
  const nextTakes = useNextTakes([
    today.main.kind === 'coaching' ? today.main.notePracticeId : null,
    today.also?.kind === 'coaching' ? today.also.notePracticeId : null,
    ...recent.map(lastNotePracticeId),
  ]);

  // 안드로이드 뒤로가기 — 홈에서는 바로 나가지 않고 앱을 종료할지 묻는다(SOMA-771).
  const { confirm, dialog } = useAppDialog();
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'android') return;
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        void confirm({ title: t('home.exitTitle'), confirmLabel: t('home.exitConfirm') }).then((ok) => {
          if (ok) BackHandler.exitApp();
        });
        return true;
      });
      return () => sub.remove();
    }, [confirm]),
  );

  // 코칭·리딩 할 일이 없을 때만 오늘의 챌린지를 받아 온다.
  const needsChallenge = loaded && !firstUser && today.main.kind === 'start' && featured === null;
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
  const readingScriptId = today.main.kind === 'reading' ? today.main.script.id : null;
  useEffect(() => {
    if (!readingScriptId) return;
    let cancelled = false;
    api
      .listReadingSessions(readingScriptId)
      .then(({ sessions }) => {
        const open = sessions.find((s) => s.status === 'in_progress' && s.progress);
        if (!cancelled) setReadingProgress(open?.progress ? { scriptId: readingScriptId, progress: open.progress } : null);
      })
      .catch(() => {
        if (!cancelled) setReadingProgress(null);
      });
    return () => {
      cancelled = true;
    };
  }, [readingScriptId]);

  const tips = translateList('home.tips');
  const tip = tips.length > 0 ? tips[tipIndex(new Date(), tips.length)] : null;

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
    <SafeAreaView style={styles.safe} edges={['top']}>
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
        // 첫 사용자 홈(pen 「가입 직후 · 소개 + 고르기 (합친 안)」) — 인사·소개 말풍선 아래에서 하나를 고르면 그 카드가 펼쳐지고
        // 「계속하기」로 그 길에 들어간다. 첫 줄(코칭)이 첫 가이드가 비추는 자리다.
        <View style={styles.flex}>
          <ScrollView contentContainerStyle={styles.firstContainer}>
            <MascotBubble
              source={MASCOT.coach}
              title={firstName ? t('home.firstHello', { name: firstName }) : t('home.firstHelloNoName')}
              guide={t('home.firstIntro')}
            />
            <View style={styles.firstHead}>
              <Text style={styles.firstQuestion} accessibilityRole="header">{t('home.firstQuestion')}</Text>
              <Text style={styles.firstSub}>{t('home.firstPickSub')}</Text>
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
          <View style={[styles.firstFooter, { paddingBottom: 11 + tabBarSpace }]}>
            <PrimaryButton
              label={firstPick ? t('home.firstContinue') : t('home.firstPickNone')}
              disabled={!firstPick}
              phLabel="home_first_continue"
              onPress={() => {
                if (firstPick) router.push(FIRST_PICK_ROUTE[firstPick]);
              }}
            />
          </View>
        </View>
      ) : (
        <ScrollView contentContainerStyle={[styles.container, { paddingBottom: tabBarSpace + 20 }]}>
          {/* 머리 — 마스코트 + 인사 + 알림 종. 일정 D-day 줄은 일정 기능(서버)이 생기면 붙인다. */}
          <View style={styles.head}>
            <Image source={MASCOT.home} style={MASCOT_SIZE.card} contentFit="contain" accessibilityIgnoresInvertColors />
            <Text style={styles.greeting}>{t('home.greeting')}</Text>
            {bell}
          </View>

          {/* 오늘 할 것 — 카드 하나. 첫 가이드가 비추는 자리다. */}
          <View ref={startTarget.ref} onLayout={startTarget.onLayout} collapsable={false} style={styles.todayCard}>
            <TodayCardBody
              item={today.main}
              nextTake={today.main.kind === 'coaching' ? nextTakes[today.main.notePracticeId] ?? null : null}
              progress={
                today.main.kind === 'reading' && readingProgress?.scriptId === today.main.script.id
                  ? readingProgress.progress
                  : null
              }
              onPress={() => openItem(today.main)}
            />
          </View>

          {/* 하던 거 한 줄 — 오늘 할 것으로 고르지 않은 나머지 하나. */}
          {today.also && (
            <Pressable
              onPress={() => openItem(today.also as TodayItem)}
              accessibilityRole="button"
              style={({ pressed }) => [styles.alsoRow, pressed && styles.pressed]}>
              <View style={[styles.alsoDot, today.also.kind === 'reading' ? styles.dotGreen : styles.dotBlue]} />
              <Text style={styles.alsoText} numberOfLines={1}>
                {alsoLabel(today.also, nextTakes)}
              </Text>
              <Feather name="chevron-right" size={18} color={palette.checkOff} />
            </Pressable>
          )}

          {/* 최근 연습 — 숨기지 않은 묶음 3개(practice.library). 대본 리딩 기록은 섞지 않는다. */}
          {recent.length > 0 && (
            <>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>{t('home.recentTitle')}</Text>
                <Pressable onPress={() => router.push('/history')} hitSlop={8}>
                  <Text style={styles.sectionLink}>{t('common.viewAll')}</Text>
                </Pressable>
              </View>
              {recent.map((r) => {
                const poster = groupPoster(r);
                const noteId = lastNotePracticeId(r);
                // 줄 제목은 다음에 해 볼 것, 없으면 장면 제목이다. 노트 제목(코치 관찰)은 쓰지 않는다.
                const rowTitle = (noteId && nextTakes[noteId]) || sceneTitle(r);
                return (
                  <Pressable
                    key={r.root_id}
                    style={({ pressed }) => [styles.listRow, pressed && styles.pressed]}
                    // 대화 중인 묶음은 그 대화로 바로 돌아간다(SOMA-672).
                    onPress={() => router.push(groupRowTarget(r))}>
                    <View style={styles.thumb}>
                      {/* 첫 장면 사진 — 서버가 만들기 전이면 원래 아이콘 그대로다(SOMA-671). */}
                      {poster ? (
                        <Image source={{ uri: poster.uri, cacheKey: poster.cacheKey }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} />
                      ) : (
                        <Feather name="film" size={16} color={palette.blue} />
                      )}
                    </View>
                    <View style={styles.flex}>
                      <View style={styles.listTitleRow}>
                        <Text style={[styles.listTitle, styles.shrink]} numberOfLines={1}>{rowTitle}</Text>
                        {r.in_progress_practice_id && (
                          <View style={styles.talkingBadge}>
                            <Text style={styles.talkingBadgeText}>{t('history.inConversation')}</Text>
                          </View>
                        )}
                      </View>
                      <Text style={styles.listMeta}>{recentDate(r.last_practiced_at ?? '')}</Text>
                    </View>
                    <Feather name="chevron-right" size={18} color={palette.checkOff} />
                  </Pressable>
                );
              })}
            </>
          )}

          {/* 입시 마감 — 실기 일정은 놓치면 1년을 기다린다. 임박한 둘만 띄운다. */}
          {sections.admissions && deadlines.length > 0 && (
            <>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>{t('home.admissionsTitle')}</Text>
                <Pressable onPress={() => router.push('/admissions')} hitSlop={8}>
                  <Text style={styles.sectionLink}>{t('common.viewAll')}</Text>
                </Pressable>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('home.admissionsA11y')}
                onPress={() => router.push('/admissions')}>
                {deadlines.map(({ university, notice, remaining }) => (
                  <View key={notice.id} style={styles.listRow}>
                    <Text style={styles.dday}>D-{remaining.days === 0 ? 'DAY' : remaining.days}</Text>
                    <View style={styles.flex}>
                      <Text style={styles.listTitle} numberOfLines={1}>{university.name}</Text>
                      <Text style={styles.listMeta} numberOfLines={1}>
                        {[notice.department, remaining.label].filter(Boolean).join(' · ')}
                      </Text>
                    </View>
                  </View>
                ))}
              </Pressable>
            </>
          )}

          {/* 오디션 마감 임박 — 입시와 같은 모양. 누르면 모아보기로 간다(app.audition). */}
          {sections.auditions && auditionDeadlines.length > 0 && (
            <>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>{t('home.auditionsTitle')}</Text>
                <Pressable onPress={() => router.push('/auditions')} hitSlop={8}>
                  <Text style={styles.sectionLink}>{t('common.viewAll')}</Text>
                </Pressable>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('home.auditionsA11y')}
                onPress={() => router.push('/auditions')}>
                {auditionDeadlines.map(({ posting, days }) => (
                  <View key={posting.id} style={styles.listRow}>
                    <Text style={styles.dday}>D-{days === 0 ? 'DAY' : days}</Text>
                    <View style={styles.flex}>
                      <Text style={styles.listTitle} numberOfLines={1}>{posting.title}</Text>
                      <Text style={styles.listMeta} numberOfLines={1}>{posting.source_name}</Text>
                    </View>
                  </View>
                ))}
              </Pressable>
            </>
          )}

          {/* 오늘의 연기 팁 — 하루 동안 같은 한 줄. */}
          {tip && (
            <View style={styles.tip} accessibilityLabel={`${t('home.tipsTitle')}: ${tip}`}>
              <Ionicons name="bulb-outline" size={18} color={palette.hintIcon} />
              <Text style={styles.tipText}>{tip}</Text>
            </View>
          )}
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
      {dialog}
    </SafeAreaView>
  );
}

function alsoLabel(item: TodayItem, nextTakes: Record<string, string | null>): string {
  if (item.kind === 'coaching') return t('home.alsoCoaching', { title: nextTakes[item.notePracticeId] || sceneTitle(item.group) });
  if (item.kind === 'reading') return t('home.alsoReading', { title: item.script.title });
  return '';
}

/** 오늘 할 것 카드 속 — 종류마다 머리 한 줄(색)·제목·보조·버튼. */
function TodayCardBody({
  item,
  nextTake = null,
  progress,
  onPress,
}: {
  item: TodayItem;
  nextTake?: string | null;
  progress: SessionProgress | null;
  onPress: () => void;
}) {
  let eyebrow: string;
  let eyebrowStyle = styles.eyebrowBlue;
  let title: string;
  let sub: string | null = null;
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
    // 한 번도 안 읽은 대본은 「하던 대본」이 아니다(10/22 피드백).
    eyebrow = progress || item.script.last_practiced_at ? t('home.todayReadingEyebrow') : t('home.todayReadingEyebrowNew');
    eyebrowStyle = styles.eyebrowGreen;
    title = item.script.title;
    if (progress && progress.total > 0) {
      bar = Math.min(1, Math.max(0, progress.done / progress.total));
      sub = t('home.todayReadingProgress', { total: progress.total, done: progress.done });
      cta = progress.done < progress.total ? t('home.todayReadingCta', { line: progress.done + 1 }) : t('home.todayReadingCtaPlain');
    } else {
      // 만들어 두고 아직 안 읽은 대본은 「리딩 시작하기」.
      cta = item.script.last_practiced_at ? t('home.todayReadingCtaPlain') : t('home.todayReadingCtaStart');
    }
  } else if (item.kind === 'challenge') {
    eyebrow = item.daysLeft === 0 ? t('home.todayChallengeEyebrowToday') : t('home.todayChallengeEyebrow', { days: item.daysLeft });
    eyebrowStyle = styles.eyebrowOrange;
    title = `“${item.challenge.line}”`;
    sub = item.challenge.work;
    cta = t('home.todayChallengeCta');
  } else {
    eyebrow = t('home.todayStartEyebrow');
    title = t('home.todayStartTitle');
    sub = t('home.todayStartSub');
    cta = t('home.todayStartCta');
  }

  return (
    <>
      <Text style={[styles.eyebrow, eyebrowStyle]}>{eyebrow}</Text>
      <Text style={styles.todayTitle} numberOfLines={3}>{title}</Text>
      {bar !== null && (
        <View style={styles.barTrack}>
          <View style={[styles.barFill, { width: `${Math.round(bar * 100)}%` }]} />
        </View>
      )}
      {sub ? <Text style={styles.todaySub} numberOfLines={2}>{sub}</Text> : null}
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={cta}
        style={({ pressed }) => [styles.todayCta, pressed && styles.pressed]}>
        <Text style={styles.todayCtaText}>{cta}</Text>
      </Pressable>
    </>
  );
}

/**
 * 첫 사용자 홈의 선택 카드(pen 합친 안) — 회색 카드(#F2F4F6, 모서리 16, 안쪽 [20,16]) 안에 흰 아이콘 칸 40 · 제목 18/700 ·
 * 설명 14/400 #6B7684 · 오른쪽 라디오 22. 고르면 옅은 파랑 바탕에 파란 테두리 1.5, 제목 파랑, 라디오에 체크.
 * `steps`가 있으면 고른 동안 「이렇게 진행돼요」 1·2·3 단계가 펼쳐진다(pen 「홈 · 첫 사용자 · 코칭 고름」).
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
      <View style={styles.choiceRow}>
        <View style={styles.choiceIcon}>
          <Feather name={icon} size={20} color={palette.blue} />
        </View>
        <View style={styles.choiceBody}>
          <Text style={[styles.choiceText, selected && styles.choiceTextOn]}>{title}</Text>
          <Text style={styles.choiceSub}>{sub}</Text>
        </View>
        <View style={[styles.radio, selected && styles.radioOn]}>
          {selected ? <Feather name="check" size={14} color={palette.onAccent} /> : null}
        </View>
      </View>
      {selected && steps && steps.length > 0 ? (
        <View style={styles.steps}>
          <Text style={styles.stepsLabel}>{t('home.firstStepsLabel')}</Text>
          {steps.map((step, i) => (
            <View key={step} style={styles.stepRow}>
              <View style={styles.stepNum}>
                <Text style={styles.stepNumText}>{i + 1}</Text>
              </View>
              <Text style={styles.stepText}>{step}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  // 아래 탭 바가 화면 위에 떠 있어 그만큼 바닥을 비운다.
  container: { paddingHorizontal: 20, paddingTop: 30 },
  flex: { flex: 1, minWidth: 0 },
  shrink: { flexShrink: 1 },
  pressed: { opacity: 0.85 },

  // 첫 사용자 홈(pen 합친 안)
  firstContainer: { paddingTop: 32, paddingHorizontal: 20, paddingBottom: 24 },
  firstHead: { marginTop: 36, gap: 4, paddingLeft: 2 },
  firstQuestion: { fontSize: 20, fontWeight: '800', lineHeight: 27, color: palette.text },
  firstSub: { fontSize: 13.5, fontWeight: '500', lineHeight: 19, color: palette.textFaint },
  firstChoices: { gap: 12, marginTop: 16 },
  firstFooter: { paddingHorizontal: 20, paddingTop: 8 },
  choice: {
    gap: 14,
    paddingVertical: 20,
    paddingHorizontal: 16,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: palette.bgSoft,
    backgroundColor: palette.bgSoft,
  },
  choiceOn: { backgroundColor: palette.blueSoft, borderColor: palette.blue },
  choiceRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  choiceIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: palette.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  choiceBody: { flex: 1, minWidth: 0, gap: 3 },
  choiceText: { fontSize: 18, fontWeight: '700', lineHeight: 23, color: palette.text },
  choiceTextOn: { color: palette.blueDeep },
  choiceSub: { fontSize: 14, fontWeight: '400', lineHeight: 20, color: palette.textMuted },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: palette.border,
    backgroundColor: palette.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: { borderWidth: 0, backgroundColor: palette.blue },
  steps: { gap: 10, paddingTop: 14, borderTopWidth: 1, borderTopColor: palette.blueLine },
  stepsLabel: { fontSize: 13, fontWeight: '700', color: palette.blueDeep },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepNum: { width: 20, height: 20, borderRadius: 10, backgroundColor: palette.card, alignItems: 'center', justifyContent: 'center' },
  stepNumText: { fontSize: 12, fontWeight: '700', color: palette.blue },
  stepText: { flex: 1, fontSize: 14, fontWeight: '500', lineHeight: 20, color: palette.textStrong },

  // 머리
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  greeting: { flex: 1, fontSize: 20, fontWeight: '800', lineHeight: 27, color: palette.text },
  bell: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  bellDot: {
    position: 'absolute',
    top: 4,
    right: 5,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: palette.flame,
    borderWidth: 1.5,
    borderColor: palette.bg,
  },

  // 오늘 할 것
  todayCard: { marginTop: 24, backgroundColor: palette.bgSoft, borderRadius: 22, padding: 20, gap: 10 },
  eyebrow: { fontSize: 12, fontWeight: '800', lineHeight: 18 },
  eyebrowBlue: { color: palette.blue },
  eyebrowGreen: { color: palette.green },
  eyebrowOrange: { color: palette.flame },
  todayTitle: { fontSize: 18, fontWeight: '800', lineHeight: 24, color: palette.text },
  barTrack: { height: 8, borderRadius: 4, backgroundColor: palette.bg, overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 4, backgroundColor: palette.green },
  todaySub: { fontSize: 13, fontWeight: '600', lineHeight: 20, color: palette.textDim },
  todayCta: {
    marginTop: 4,
    height: 50,
    borderRadius: 25,
    backgroundColor: palette.blue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  todayCtaText: { fontSize: 16, fontWeight: '800', color: palette.onAccent },

  // 하던 거 한 줄
  alsoRow: { marginTop: 18, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6, paddingHorizontal: 4 },
  alsoDot: { width: 8, height: 8, borderRadius: 4 },
  dotBlue: { backgroundColor: palette.blue },
  dotGreen: { backgroundColor: palette.green },
  alsoText: { flex: 1, fontSize: 15, fontWeight: '700', lineHeight: 22, color: palette.textDim },

  // 최근 연습·마감 임박 — 카드 없이 줄만
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 28,
    marginBottom: 4,
    paddingHorizontal: 4,
  },
  sectionTitle: { fontSize: 14, fontWeight: '800', color: palette.textFaint },
  sectionLink: { fontSize: 13, fontWeight: '700', color: palette.blue },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 4 },
  thumb: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: palette.blueSoft,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  listTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  listTitle: { fontSize: 15, fontWeight: '700', lineHeight: 22, color: palette.text },
  listMeta: { marginTop: 2, fontSize: 12, fontWeight: '500', lineHeight: 17, color: palette.textFaint },
  talkingBadge: { borderRadius: 9999, backgroundColor: palette.blueSoft, paddingVertical: 2, paddingHorizontal: 8 },
  talkingBadgeText: { fontSize: 11, fontWeight: '800', color: palette.blueDeep },
  dday: { minWidth: 52, fontSize: 13, fontWeight: '800', color: palette.flameDeep },

  // 오늘의 연기 팁
  tip: { marginTop: 32, flexDirection: 'row', gap: 10, paddingHorizontal: 4 },
  tipText: { flex: 1, fontSize: 14, fontWeight: '600', lineHeight: 21, color: palette.textMuted },
});
