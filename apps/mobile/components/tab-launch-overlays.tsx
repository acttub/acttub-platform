import { useFocusEffect, useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Platform, ToastAndroid } from 'react-native';

import { AnnouncementPoster } from '@/components/announcement-poster';
import { FirstUseIntro, type FirstPick } from '@/components/first-use-intro';
import { StreakCelebrationScreen } from '@/components/streak-celebration-screen';
import { usePracticeRecords } from '@/hooks/use-practice-records';
import { useAuth } from '@/lib/auth';
import { hasSeenSpotlight, hasSeenTutorial, markSpotlightSeen, markTutorialSeen } from '@/lib/guide-state';
import { translate as t } from '@/lib/i18n';
import { celebrationDots, kstToday, readLastSeenStreak, readLastSeenStreakDay, streakCelebrationStep, writeLastSeenStreak } from '@/lib/streak-celebration';

/** 안드로이드 뒤로가기를 이 시간 안에 한 번 더 누르면 앱을 닫는다. */
const EXIT_BACK_WINDOW_MS = 2000;

const FIRST_PICK_ROUTE: Record<FirstPick, '/coaching' | '/reading'> = {
  coaching: '/coaching',
  reading: '/reading',
};

/**
 * 탭 묶음 위에 뜨는 것들(SOMA-1120 — 예전 홈이 띄우던 것). 탭 레이아웃이 탭 아래에 그린다.
 *
 * - 첫 사용자 안내(「뭐부터 해 볼까요?」): 첫 사용자로 확인되면(lib/practice/first-time) 탭 위에 한 번 덮는다. 「다음」을 누르면
 *   본 것으로 계정별로 남기고(guide-state firstUse) 고른 탭으로 간다. 연습 1회를 끝내 졸업하면 다시 뜨지 않는다.
 * - 연속일 축하(streak-celebration): 탭이 보일 때(다른 화면 뒤가 아닐 때) 같은 판정(streakCelebrationStep)으로 띄운다.
 * - 공지 포스터: 위 둘이 떠 있거나 재동의 팝업이 닫히는 중이면 미룬다.
 * - 안드로이드 뒤로가기: 더 돌아갈 탭이 없으면 바로 나가지 않고 안내 토스트, 2초 안에 한 번 더 누르면 앱을 닫는다(SOMA-771).
 */
export function TabLaunchOverlays() {
  const router = useRouter();
  const navigation = useNavigation();
  const { user, consentEntry, profile } = useAuth();
  const records = usePracticeRecords();
  const { loaded, firstTime, activityLoaded, streak, practicedToday, recordsFailed, recentDays } = records;

  // 재동의 팝업(Modal)이 닫히는 동안 다른 화면을 덮으면 iOS가 띄우지 못해, 닫힘이 끝난 뒤에 연다(iOS 시뮬레이터 700ms에서 떴다).
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

  // 탭 묶음이 보이는지 — 다른 화면(코칭 끝 등) 뒤에 숨어 있을 때 축하를 따지면 보지 못한 축하를 본 것으로 남긴다.
  const [focused, setFocused] = useState(false);
  const [introChecked, setIntroChecked] = useState(false);
  const [onboardingJustFinished, setOnboardingJustFinished] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      void hasSeenTutorial().then((seen) => {
        setIntroChecked(true);
        if (!seen) {
          void markTutorialSeen();
          setOnboardingJustFinished(true);
        }
      });
      return () => setFocused(false);
    }, []),
  );

  // 첫 사용자 안내를 이 계정이 봤는지 — 첫 사용자로 확인됐을 때만 묻는다. 모르는 동안은 띄우지 않는다.
  const [firstUseSeen, setFirstUseSeen] = useState<boolean | null>(null);
  useEffect(() => {
    if (firstTime !== 'first') return;
    let live = true;
    void hasSeenSpotlight('firstUse').then((seen) => {
      if (live) setFirstUseSeen(seen);
    });
    return () => {
      live = false;
    };
  }, [firstTime]);
  const introVisible = overlaysReady && loaded && firstTime === 'first' && firstUseSeen === false;
  const finishIntro = (pick: FirstPick) => {
    setFirstUseSeen(true);
    void markSpotlightSeen('firstUse');
    router.navigate(FIRST_PICK_ROUTE[pick]);
  };

  // 연속일이 오늘 늘었으면(마지막으로 본 값보다 크면) 딱 한 번 축하한다(SOMA-479). 판정은 streakCelebrationStep 이 한다(SOMA-494).
  const [celebrateStreak, setCelebrateStreak] = useState<number | null>(null);
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
    });
    return () => {
      cancelled = true;
    };
  }, [focused, activityLoaded, streak, practicedToday, recordsFailed]);

  // 안드로이드 뒤로가기 — 더 돌아갈 탭이 없을 때만 가로챈다(탭 기록은 backBehavior history).
  const lastBackAt = useRef(0);
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'android') return;
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        const state = navigation.getState();
        const tabs = state?.routes[state.index]?.state as { history?: unknown[] } | undefined;
        if ((tabs?.history?.length ?? 0) > 1) return false;
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
    }, [navigation]),
  );

  const firstName = profile.me?.profile?.name?.trim() ?? '';
  return (
    <>
      {introVisible && <FirstUseIntro name={firstName} onContinue={finishIntro} />}
      {celebrateStreak !== null && overlaysReady && !introVisible && (
        <StreakCelebrationScreen streak={celebrateStreak} dots={celebrationDots(recentDays)} onDone={() => setCelebrateStreak(null)} />
      )}
      <AnnouncementPoster
        loggedIn={!!user}
        blocked={!overlaysReady || !introChecked || introVisible || celebrateStreak !== null}
        onboardingJustFinished={onboardingJustFinished}
      />
    </>
  );
}
