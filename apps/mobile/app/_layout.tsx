import { reminderTarget } from '@/lib/reminder-target';
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
import { useEffect, useRef, useState } from 'react';
import { AppState, Platform, StyleSheet, View, type GestureResponderEvent } from 'react-native';
import 'react-native-reanimated';

import '@/lib/global-font';
import { logScreenView } from '@/lib/analytics';
import { initMetaSdk } from '@/lib/meta-events';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { beforeTrackingRequest, TRACKING_INTRO_KEY } from '@/lib/tracking-intro';
import { postHog, syncPostHog } from '@/lib/posthog';
import { startSignupAttributionListener } from '@/lib/signup-attribution-runtime';
import { initCrashlytics, markScreen } from '@/lib/crashlytics';
import { api } from '@/lib/api';
import { installNavigationGuard } from '@/lib/navigation-guard';
import { setVoiceModelSource } from '@/lib/reading/tts/assets';
import { tabBackTitle } from '@/lib/tab-back-title';
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
  onPushTapped,
} from '@/lib/notifications';
import type { PendingAnalysisHandle } from '@/lib/pending-analysis';
import { palette } from '@/constants/palette';
import { translate as t } from '@/lib/i18n';

// 아이콘 폰트가 로드되기 전에 UI가 그려지면 탭바 아이콘이 빈칸으로 뜬다.
// 로드가 끝날 때까지 스플래시를 유지해 아이콘 누락(회귀)을 막는다.
SplashScreen.preventAutoHideAsync();

// 포그라운드에서도 알림 배너가 뜨게 한다. 모듈이 없는 빌드에서는 아무 일도 하지 않는다.
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
    return onPushTapped((data) => {
      // evening_reminder: resume이면 같은 회차, 나머지는 기존 홈이다.
      const reminder = reminderTarget(data);
      if (reminder) {
        router.replace(reminder as Parameters<typeof router.replace>[0]);
        return;
      }
      if (challengePushTarget(data)) router.push('/notifications');
    });
  }, [router]);

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
    if (readyToShow) {
      void SplashScreen.hideAsync();
    }
  }, [
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
                // pen NavHeader(SOMA-748) — 가운데 제목 17/700, 아래 줄 없음. iOS 의 AppHeader 와 모양을 맞춘다.
                headerTitleAlign: 'center',
                headerShadowVisible: false,
                headerTitleStyle: { fontSize: 17, fontWeight: '700', color: palette.text },
              }
        }>
        <Stack.Screen name="update-required" options={{ headerShown: false, gestureEnabled: false }} />
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="consent" options={{ headerShown: false }} />
        <Stack.Screen name="profile-name" options={{ headerShown: false }} />
        <Stack.Screen name="profile-edit" options={{ title: t('profileName.editTitle') }} />
        <Stack.Screen name="portfolio-edit" options={{ title: t('portfolio.title') }} />
        <Stack.Screen name="guest-transfer" options={{ title: t('guestTransfer.title') }} />
        <Stack.Screen
          name="(tabs)"
          options={({ route }) => ({ headerShown: false, title: tabBackTitle(getFocusedRouteNameFromRoute(route)) })}
        />
        <Stack.Screen
          name="delete-account"
          options={{ title: t('stack.withdraw'), headerBackTitle: t('stack.backToSettings') }}
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
        <Stack.Screen name="reading/coach" options={{ title: t('readingCoach.coachName') }} />
        <Stack.Screen name="reading/pronunciation" options={{ title: t('reading.pronReportRow') }} />
        {/* 자체 헤더(← 설정 · 제목)를 그린다 — 기본 헤더를 겹치면 라우트 이름 "memory"가 제목으로 나온다. */}
        <Stack.Screen name="memory" options={{ headerShown: false }} />
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
    const initialize = () => initMetaSdk(() => beforeTrackingRequest({
      platform: Platform.OS,
      getStatus: async () => (await getTrackingPermissionsAsync()).status,
      getSeen: () => AsyncStorage.getItem(TRACKING_INTRO_KEY),
      markSeen: () => AsyncStorage.setItem(TRACKING_INTRO_KEY, '1'),
      // pen S1.2 — 설명 화면 없이 로그인 화면 위에 바로 iOS 시스템 팝업만 띄운다.
      show: async () => undefined,
    }));
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
          <RootNavigator />
          {/* 첫 가이드는 화면 안이 아니라 여기서 덮는다 — 탭바까지 덮어야 하고, 앱과 같은 창이라야
              비출 자리의 좌표가 맞는다 (SOMA-550). */}
          <SpotlightHost />
          <StatusBar style="dark" />
        </ThemeProvider>
      </AuthProvider>
    </View>
  );
}
