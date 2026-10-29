import { reminderOpenEvent, reminderTarget } from '@/lib/reminder-target';
import Feather from '@expo/vector-icons/Feather';
import { DefaultTheme, ThemeProvider, getFocusedRouteNameFromRoute } from '@react-navigation/native';
import type { NativeStackHeaderProps } from '@react-navigation/native-stack';
import { useFonts } from 'expo-font';
import {
  router,
  Stack,
  useGlobalSearchParams,
  usePathname,
  useRouter,
  useSegments,
  type Href,
} from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { getTrackingPermissionsAsync } from 'expo-tracking-transparency';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AppState, Platform, StyleSheet, View, type GestureResponderEvent } from 'react-native';
import 'react-native-reanimated';

import '@/lib/global-font';
import { useStoreRecovery } from '@/hooks/use-store-recovery';
import { logEvent, logScreenView } from '@/lib/analytics';
import { adRequestConfigFor } from '@/lib/ads';
import { initAdMob, setAdRequestConfig } from '@/lib/ads-native';
import { kstDate } from '@/lib/auditions';
import { initMetaSdk } from '@/lib/meta-events';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { beforeTrackingRequest, TRACKING_INTRO_KEY } from '@/lib/tracking-intro';
import { postHog, syncPostHog } from '@/lib/posthog';
import { startSignupAttributionListener } from '@/lib/signup-attribution-runtime';
import { initCrashlytics, markScreen } from '@/lib/crashlytics';
import { api } from '@/lib/api';
import { installNavigationGuard } from '@/lib/navigation-guard';
import { setVoiceModelSource } from '@/lib/reading/tts/assets';
import { loadAppConfig } from '@/lib/app-config-load';
import { tabBackTitle } from '@/lib/tab-back-title';
import { HOME_SPLASH_HOLD_MS, isHomeReady, shouldHoldSplashForHome, subscribeHomeReady } from '@/lib/launch-splash';
import { AppHeader } from '@/components/app-header';
import { HeaderBack } from '@/components/header-back';
import { pendingAnalysisStore } from '@/lib/analysis-storage';
import { challengePushTarget } from '@/lib/challenge/notification-center';
import {
  recoveryStatusForConsentGate,
  resolveAnalyzingBootstrapRoute,
  bootstrapSessionKey,
  resolveBootstrapStep,
  type BootstrapRecoveryParams,
} from '@/lib/app-bootstrap';
import { sweepDeviceFiles } from '@/lib/account-files';
import { MarketingNoticeHost } from '@/components/marketing-notice-dialog';
import { ReconsentPopup } from '@/components/reconsent-popup';
import { SpotlightHost } from '@/components/spotlight-guide';
import { AuthProvider, useAuth } from '@/lib/auth';
import {
  configureNotificationHandling,
  flushPendingPushTokenDeletions,
  capturePushOpen,
  onPushTapped,
  recordColdStartPushOpen,
  setPushOpenSignedIn,
} from '@/lib/notifications';
import type { PendingAnalysisHandle } from '@/lib/pending-analysis';
import { palette } from '@/constants/palette';
import { onLanguageChange, translate as t } from '@/lib/i18n';

// 아이콘 폰트가 로드되기 전에 UI가 그려지면 탭바 아이콘이 빈칸으로 뜬다.
// 로드가 끝날 때까지 스플래시를 유지해 아이콘 누락(회귀)을 막는다.
SplashScreen.preventAutoHideAsync();

// 포그라운드에서도 알림 배너가 뜨게 한다(보고 있는 화면과 겹치는 알림만 숨긴다). 모듈이 없는 빌드에서는 아무 일도 하지 않는다.
configureNotificationHandling();
// 로그아웃 때 지우지 못한 푸시 토큰을 앱을 열 때 다시 보낸다 — 로그인 없이 받는 요청이라
// 로그인 화면에서도 된다. 저녁 리마인드는 게이트를 통과한 뒤에 맞춘다(lib/auth.tsx).
void flushPendingPushTokenDeletions();
// 앞선 실행이 올리던 도중에 죽어 남긴 임시 파일(줄인 사진·영상)을 지운다. 아직 아무것도 올리지
// 않는 때라 쓰는 중인 파일을 건드리지 않는다.
void sweepDeviceFiles();
// 버튼을 연달아 눌러도 같은 화면이 한 번만 열리고, 뒤로 가기는 한 화면만 닫힌다(lib/navigation-guard.ts).
installNavigationGuard(router);
// 리딩 기기 목소리 모델은 서버가 주는 fp16 묶음 주소로 받는다(SOMA-747). 못 받으면 원본 fp32.
setVoiceModelSource(() => api.getVoiceModel());
// 운영이 바꾸는 값(평가 요청 주기·리딩 감지·칩 목록 등)을 서버에서 받는다(SOMA-939). 기다리지 않는다 — 받기 전엔 기본값이다.
void loadAppConfig();

export const unstable_settings = {
  anchor: '(tabs)',
};

const theme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: palette.bg,
    card: palette.bg,
    text: palette.text,
    primary: palette.blue,
    border: palette.border,
  },
};

/** (426 업데이트 안내 →) 인증 → 동의 → 프로필 → pending 분석 순서로 최초 화면을 게이트한다. */
function RootNavigator() {
  const {
    status,
    user,
    consentEntry,
    profile,
    signup,
    updateRequired,
  } = useAuth();
  const profileStatus = profile.status;
  // SOMA-876 — 나이에 따라 AdMob 요청 설정을 다시 건다. 로그아웃·프로필 미수신은 청소년 기준이다.
  const adBirthDate = user ? (profile.me?.profile?.birth_date ?? null) : null;
  useEffect(() => {
    void setAdRequestConfig(adRequestConfigFor(adBirthDate, kstDate()));
  }, [adBirthDate]);
  const signupPending = signup !== null;
  const segments = useSegments();
  const pathname = usePathname();
  const {
    recoveryKey: currentRecoveryKey,
    practiceId: currentRecoveryPracticeId,
  } = useGlobalSearchParams<BootstrapRecoveryParams>();
  const router = useRouter();
  const hasConsentGate = consentEntry.status !== 'allowed';
  const consentGateRef = useRef({
    active: hasConsentGate,
    generation: 0,
  });
  if (consentGateRef.current.active !== hasConsentGate) {
    consentGateRef.current = {
      active: hasConsentGate,
      generation: consentGateRef.current.generation + 1,
    };
  }
  const consentGate = consentGateRef.current.generation;
  // 화면을 녹화하는 PostHog 는 현재 판 동의를 마친 동안만 켠다(lib/posthog.ts).
  useEffect(() => {
    syncPostHog(consentEntry.status);
  }, [consentEntry.status]);
  // 재동의 팝업은 결정이 필요하거나 판정을 못 읽었을 때 열리고, 통과하거나 로그아웃하면 닫힌다.
  // 다시 읽는 중(checking)에는 그대로 둔다 — 팝업 안에서 다시 읽는 동안 스피너로 남고,
  // 앱을 처음 켤 때의 판정 대기에는 열리지 않는다.
  const reconsentEligible = status === 'signedIn' && !updateRequired && !signupPending;
  // 결제는 됐는데 Pro 가 안 켜진 스토어 구매를 앱을 켜거나 앞으로 가져올 때 다시 확인받는다(SOMA-818 2단계).
  useStoreRecovery(reconsentEligible && consentEntry.status === 'allowed');
  const [reconsentOpen, setReconsentOpen] = useState(false);
  useEffect(() => {
    if (!reconsentEligible || consentEntry.status === 'allowed') setReconsentOpen(false);
    else if (consentEntry.status !== 'checking') setReconsentOpen(true);
  }, [reconsentEligible, consentEntry.status]);
  const completedBootstrapRef = useRef<{
    sessionKey: string;
    route: Href;
  } | null>(null);
  const [recovery, setRecovery] = useState<{
    status: 'loading' | 'ready';
    owner: string | null;
    consentGate: number | null;
    pending: PendingAnalysisHandle | null;
  }>({
    status: 'loading',
    owner: null,
    consentGate: null,
    pending: null,
  });

  useEffect(() => {
    let active = true;
    if (status === 'loading') {
      setRecovery({
        status: 'loading',
        owner: null,
        consentGate: null,
        pending: null,
      });
      return () => {
        active = false;
      };
    }
    if (status === 'signedOut' || !user) {
      setRecovery({
        status: 'ready',
        owner: null,
        consentGate,
        pending: null,
      });
      return () => {
        active = false;
      };
    }
    setRecovery({
      status: 'loading',
      owner: user.id,
      consentGate,
      pending: null,
    });
    void pendingAnalysisStore
      .loadForOwner(user.id)
      .then((pending) => {
        if (active) {
          setRecovery({
            status: 'ready',
            owner: user.id,
            consentGate,
            pending,
          });
        }
      })
      .catch(() => {
        if (active) {
          setRecovery({
            status: 'ready',
            owner: user.id,
            consentGate,
            pending: null,
          });
        }
      });
    return () => {
      active = false;
    };
  }, [status, user, consentGate]);

  // 푸시를 누르면 알림 식별자로 알림함을 연다(잠금 화면 문구에는 이름·본문이 없다).
  useEffect(() => {
    return onPushTapped((data, identifier) => {
      capturePushOpen(data, identifier);
      // analysis_complete·resume은 같은 회차, 다른 연습 알림은 알림이 말한 화면(SOMA-862), 못 정하면 홈이다.
      const opened = reminderOpenEvent(data);
      if (opened) void logEvent('reminder_open', opened);
      const reminder = reminderTarget(data);
      if (reminder) {
        router.replace(reminder as Parameters<typeof router.replace>[0]);
        return;
      }
      if (challengePushTarget(data)) router.push('/notifications');
    });
  }, [router]);

  // 꺼진 앱을 푸시로 열었다면 리스너보다 탭이 먼저 지나갔을 수 있어 한 번 조회해 남긴다(측정만, 이동은 그대로).
  useEffect(() => {
    void recordColdStartPushOpen();
  }, []);

  // 푸시 탭이 로그인보다 먼저 와도 로그인한 회원이 생기면 그때 보낸다.
  useEffect(() => {
    setPushOpenSignedIn(status === 'signedIn' && !!user);
  }, [status, user]);

  useEffect(() => {
    const bootstrap = resolveBootstrapStep({
      updateRequired,
      authStatus: status,
      signupPending,
      userId: user?.id ?? null,
      consentEntryStatus: consentEntry.status,
      profileStatus,
      recoveryStatus: recoveryStatusForConsentGate(recovery, consentGate),
      recoveryOwner: recovery.owner,
      pending: recovery.pending,
    });
    const sessionKey = bootstrapSessionKey(status, user?.id ?? null);
    if (
      completedBootstrapRef.current &&
      completedBootstrapRef.current.sessionKey !== sessionKey
    ) {
      completedBootstrapRef.current = null;
    }

    // /login·/consent는 typedRoutes가 다음 dev 서버 실행 때 인식 — 그전까지 캐스트로 처리.
    const first = segments[0] as string;
    const inLogin = first === 'login';
    const inConsent = first === 'consent';
    const inProfileName = first === 'profile-name';
    const inUpdateRequired = first === 'update-required';

    if (bootstrap.stage === 'update-gate') {
      completedBootstrapRef.current = null;
      if (!inUpdateRequired) router.replace('/update-required' as Href);
      return;
    }
    if (bootstrap.stage === 'auth-gate') {
      if (bootstrap.route === '/login' && !inLogin) {
        // 탈퇴·로그아웃 뒤 맨 위 화면만 바꾸면 아래에 홈·설정이 남아, 로그인 화면에서 뒤로 가면 그 화면이 나왔다
        // 다시 로그인으로 바뀌기를 되풀이하다 안드로이드에서 앱이 꺼졌다(SOMA-703). 쌓인 화면을 다 닫고 바꾼다.
        if (router.canDismiss()) router.dismissAll();
        router.replace('/login' as Href);
      }
      return;
    }
    if (bootstrap.stage === 'signup-gate') {
      // 처음 온 신원의 동의 화면.
      if (!inConsent) router.replace('/consent' as Href);
      return;
    }
    if (bootstrap.stage === 'consent-gate') {
      completedBootstrapRef.current = null;
      // 재동의 팝업은 지금 화면 위에 뜬다. 로그인 직후(로그인·가입 화면)일 때만 홈을 깐다.
      if (bootstrap.route && (inLogin || inConsent)) router.replace(bootstrap.route as Href);
      return;
    }
    if (bootstrap.stage === 'profile-gate') {
      completedBootstrapRef.current = null;
      if (bootstrap.route === '/profile-name' && !inProfileName) {
        router.replace('/profile-name' as Href);
      }
      return;
    }
    if (bootstrap.stage === 'pending-recovery' || !bootstrap.route || !sessionKey) {
      return;
    }

    const completed = completedBootstrapRef.current;
    if (completed?.sessionKey === sessionKey) {
      if (inLogin || inConsent || inProfileName) {
        router.replace(completed.route);
      }
      return;
    }

    if (typeof bootstrap.route === 'object') {
      if (
        resolveAnalyzingBootstrapRoute(
          pathname,
          {
            recoveryKey: currentRecoveryKey,
            practiceId: currentRecoveryPracticeId,
          },
          bootstrap.route,
        ) === 'replace'
      ) {
        router.replace(bootstrap.route as Href);
        return;
      }
    } else if (inLogin || inConsent || inProfileName) {
      router.replace(bootstrap.route as Href);
    }
    completedBootstrapRef.current = {
      sessionKey,
      route: bootstrap.route as Href,
    };
  }, [
    updateRequired,
    status,
    signupPending,
    user,
    consentEntry.status,
    profileStatus,
    consentGate,
    recovery,
    segments,
    pathname,
    currentRecoveryKey,
    currentRecoveryPracticeId,
    router,
  ]);

  // 홈으로 들어가는 길이면 홈이 첫 데이터를 받을 때까지 로고를 붙잡는다(lib/launch-splash.ts).
  // 예전에는 로고가 닫힌 뒤 홈이 데이터를 받는 동안 작은 로딩 표시가 잠깐 보였다.
  const homeReady = useSyncExternalStore(subscribeHomeReady, isHomeReady);
  const signedInHome =
    !updateRequired &&
    status === 'signedIn' &&
    Boolean(user) &&
    consentEntry.status === 'allowed' &&
    profileStatus === 'complete' &&
    recovery.status === 'ready' &&
    recovery.owner === user?.id;
  const [homeHoldExpired, setHomeHoldExpired] = useState(false);
  useEffect(() => {
    if (!signedInHome) return;
    const timer = setTimeout(() => setHomeHoldExpired(true), HOME_SPLASH_HOLD_MS);
    return () => clearTimeout(timer);
  }, [signedInHome]);
  const holdSplashForHome = shouldHoldSplashForHome({
    signedInHome,
    pathname,
    homeReady,
    holdExpired: homeHoldExpired,
  });

  useEffect(() => {
    const consentScreenReady =
      consentEntry.status === 'error' ||
      consentEntry.status === 'decision_required';
    const profileScreenReady = profileStatus === 'error' || profileStatus === 'required';
    const readyToShow =
      updateRequired ||
      status === 'signedOut' ||
      (status === 'signedIn' &&
        Boolean(user) &&
        (consentScreenReady ||
          (consentEntry.status === 'allowed' &&
            (profileScreenReady ||
              (profileStatus === 'complete' &&
                recovery.status === 'ready' &&
                recovery.owner === user?.id)))));
    if (readyToShow && !holdSplashForHome) {
      void SplashScreen.hideAsync();
    }
  }, [
    holdSplashForHome,
    updateRequired,
    status,
    user,
    consentEntry.status,
    profileStatus,
    recovery.status,
    recovery.owner,
  ]);

  if (status === 'loading' && !updateRequired) return null;

  return (
    <>
      <Stack
        screenOptions={
          Platform.OS === 'ios'
            ? {
                // iOS 는 헤더를 직접 그린다 — 네이티브 헤더는 버튼에 유리 배경을 씌워 꺾쇠가 뭉개져 보인다(components/app-header).
                headerBackVisible: false,
                headerLeft: () => <HeaderBack />,
                header: (props: NativeStackHeaderProps) => <AppHeader {...props} />,
              }
            : {
                // 안드로이드는 네이티브 뒤로 버튼에 설정 화면과 같은 꺾쇠 그림만 씌운다. 헤더에 직접 만든 버튼을 넣으면,
                // 뒤로 가기를 붙잡았다 다시 보내는 화면(예시 코치)이 닫힐 때 네이티브 헤더가 그 버튼을 두 번 붙이려다
                // 앱이 꺼졌다(SOMA-665). 0.1.3 처럼 헤더에 우리 조각을 넣지 않으면 그 길을 타지 않는다.
                headerBackIcon: { type: 'image', source: require('@/assets/images/header-back.png') },
                // 디자인 시스템 NavHeader — 가운데 제목 headline(17/600), 아래 줄 없음. iOS 의 AppHeader 와 모양을 맞춘다.
                headerTitleAlign: 'center',
                headerShadowVisible: false,
                headerTitleStyle: { fontSize: 17, fontWeight: '600', color: palette.text },
              }
        }>
        <Stack.Screen name="update-required" options={{ headerShown: false, gestureEnabled: false }} />
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="consent" options={{ headerShown: false }} />
        <Stack.Screen name="profile-name" options={{ headerShown: false }} />
        <Stack.Screen name="profile-edit" options={{ title: t('profileName.editTitle') }} />
        <Stack.Screen name="portfolio-edit" options={{ title: t('portfolio.title') }} />
        <Stack.Screen
          name="(tabs)"
          options={({ route }) => ({ headerShown: false, title: tabBackTitle(getFocusedRouteNameFromRoute(route)) })}
        />
        <Stack.Screen name="upload" options={{ title: t('stack.upload') }} />
        <Stack.Screen name="talk" options={{ title: t('talk.title') }} />
        <Stack.Screen
          name="record-video"
          // 헤더는 여기 한 곳에서 숨긴다 — 화면이 따로 바꾸면 iOS에서 다시 그릴 때마다 뒤집혀 깜빡였다.
          options={{ title: t('record.screenTitle'), presentation: 'fullScreenModal', headerShown: false }}
        />
        <Stack.Screen name="analyzing" options={{ title: t('stack.analyzing') }} />
        <Stack.Screen name="coach" options={{ title: t('stack.coach') }} />
        <Stack.Screen name="report" options={{ title: t('stack.report') }} />
        {/* 아래 셋은 화면 안에 자체 헤더가 있다. 등록해 두지 않으면 기본 헤더가
            한 겹 더 붙어 '뒤로' 버튼이 두 개로 보인다. */}
        <Stack.Screen name="admissions/index" options={{ headerShown: false }} />
        <Stack.Screen name="admissions/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="auditions/index" options={{ headerShown: false }} />
        <Stack.Screen name="challenge-detail" options={{ title: t('challenges.detailTitle') }} />
        <Stack.Screen name="challenge-play" options={{ headerShown: false, presentation: 'fullScreenModal' }} />
        <Stack.Screen name="challenge-upload" options={{ title: t('challengeUpload.title') }} />
        <Stack.Screen name="saved-videos" options={{ headerShown: false }} />
        <Stack.Screen name="line-pick" options={{ title: t('linePick.title') }} />
        <Stack.Screen name="challenge-others" options={{ title: t('challenges.sameLineTitle') }} />
        <Stack.Screen name="line-search" options={{ headerShown: false }} />
        <Stack.Screen name="line-new" options={{ headerShown: false, presentation: 'modal' }} />
        <Stack.Screen name="reading/new" options={{ title: t('reading.titleNew') }} />
        <Stack.Screen name="reading/detail" options={{ title: t('reading.titleDetail') }} />
        <Stack.Screen name="reading/session" options={{ title: '' }} />
        <Stack.Screen name="reading/full" options={{ title: t('reading.titleFull') }} />
        <Stack.Screen name="reading/roles" options={{ title: t('reading.titleRoles') }} />
        <Stack.Screen name="reading/range" options={{ title: t('reading.titleRange') }} />
        <Stack.Screen name="reading/play" options={{ headerShown: false }} />
        <Stack.Screen name="reading/diff" options={{ title: t('reading.diffTitle') }} />
        <Stack.Screen name="reading/pronunciation" options={{ title: t('reading.pronReportRow') }} />
        {/* 자체 헤더(← 설정 · 제목)를 그린다 — 기본 헤더를 겹치면 라우트 이름 "memory"가 제목으로 나온다. */}
        <Stack.Screen name="memory" options={{ headerShown: false }} />
        {/* 앱 Pro 정기결제(SOMA-818). 서버 플래그가 꺼져 있으면 진입점(설정 줄·한도 시트)이 없어 열리지 않는다. */}
        <Stack.Screen name="pro" options={{ headerShown: false, presentation: 'modal' }} />
        <Stack.Screen name="pro-done" options={{ headerShown: false, gestureEnabled: false }} />
        <Stack.Screen name="pro-manage" options={{ headerShown: false }} />
      </Stack>
      <ReconsentPopup visible={reconsentOpen} />
      {/* 가입 동의·재동의의 광고성 정보 처리 결과(S5.13)를 다음 화면 위에 띄운다. */}
      <MarketingNoticeHost />
    </>
  );
}

function captureTap(e: GestureResponderEvent) {
  postHog.touch(e as unknown as Parameters<typeof postHog.touch>[0]);
}

const styles = StyleSheet.create({ root: { flex: 1 } });

function ScreenTracker() {
  const segments = useSegments();
  useEffect(() => {
    const screen = '/' + segments.join('/');
    logScreenView(screen);
    markScreen(screen);
  }, [segments]);
  return null;
}

export default function RootLayout() {
  const [languageKey, setLanguageKey] = useState(0);
  useEffect(() => onLanguageChange(() => setLanguageKey((k) => k + 1)), []);
  const [fontsLoaded] = useFonts({
    ...Feather.font,
    // 굵기별 static 서브셋 — 가변폰트는 안드로이드에서 fontWeight가 안 먹는다([[global-font]]).
    Pretendard: require('@/assets/fonts/Pretendard-Regular.subset.ttf'),
    'Pretendard-SemiBold': require('@/assets/fonts/Pretendard-SemiBold.subset.ttf'),
    'Pretendard-Bold': require('@/assets/fonts/Pretendard-Bold.subset.ttf'),
  });

  // 크래시 수집 — 버전별 스택을 Firebase Crashlytics 로 모은다.
  useEffect(() => {
    void initCrashlytics();
  }, []);

  // Meta SDK 초기화(SOMA-481). iOS ATT 팝업은 앱이 활성 상태일 때만 뜨므로,
  // 아직 활성이 아니면 활성이 되는 순간까지 기다렸다가 한 번만 부른다.
  useEffect(() => {
    if (!fontsLoaded) return;
    // AdMob(SOMA-876)은 ATT 답을 받은 뒤 초기화한다 — 같은 팝업을 다시 묻지 않는다.
    const initialize = async () => {
      await initMetaSdk(() => beforeTrackingRequest({
        platform: Platform.OS,
        getStatus: async () => (await getTrackingPermissionsAsync()).status,
        getSeen: () => AsyncStorage.getItem(TRACKING_INTRO_KEY),
        markSeen: () => AsyncStorage.setItem(TRACKING_INTRO_KEY, '1'),
        // pen S1.2 — 설명 화면 없이 로그인 화면 위에 바로 iOS 시스템 팝업만 띄운다.
        show: async () => undefined,
      }));
      await initAdMob();
    };
    // 설치 귀속 결과는 SDK 초기화 뒤 곧 온다. 받는 쪽은 먼저 세워 둔다(SOMA-588).
    startSignupAttributionListener();
    if (AppState.currentState === 'active') {
      void initialize();
      return;
    }
    const subscription = AppState.addEventListener('change', (next) => {
      if (next !== 'active') return;
      subscription.remove();
      void initialize();
    });
    return () => subscription.remove();
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  return (
    // 버튼 탭 기록(SOMA-732) — 손을 뗄 때마다 캡처 단계에서 한 번 본다. 탭을 막거나 바꾸지 않는다.
    <View style={styles.root} onTouchEndCapture={captureTap}>
      <AuthProvider>
        <ThemeProvider value={theme}>
          <ScreenTracker />
          {/* 언어를 바꾸면 화면 전체를 새로 그린다 — 홈부터 다시 열리지만 껐다 켤 필요는 없다. */}
          <RootNavigator key={languageKey} />
          {/* 첫 가이드는 화면 안이 아니라 여기서 덮는다 — 탭바까지 덮어야 하고, 앱과 같은 창이라야
              비출 자리의 좌표가 맞는다 (SOMA-550). */}
          <SpotlightHost />
          <StatusBar style="dark" />
        </ThemeProvider>
      </AuthProvider>
    </View>
  );
}
