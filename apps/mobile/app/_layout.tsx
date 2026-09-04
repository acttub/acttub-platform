import Feather from '@expo/vector-icons/Feather';
import { DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import {
  Stack,
  useGlobalSearchParams,
  usePathname,
  useRouter,
  useSegments,
  type Href,
} from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import 'react-native-reanimated';

import '@/lib/global-font';
import { logScreenView } from '@/lib/analytics';
import { initMetaSdk } from '@/lib/meta-events';
import { pendingAnalysisStore } from '@/lib/analysis-storage';
import {
  recoveryStatusForConsentGate,
  routeAllowedWhileConsentBlocked,
  resolveAnalyzingBootstrapRoute,
  resolveBootstrapStep,
  resolvePostConsentRoute,
  type BootstrapRecoveryParams,
} from '@/lib/app-bootstrap';
import { AuthProvider, useAuth } from '@/lib/auth';
import { configureNotificationHandling, syncDailyNudge } from '@/lib/notifications';
import type { PendingAnalysisHandle } from '@/lib/pending-analysis';
import { palette } from '@/constants/palette';
import { translate as t } from '@/lib/i18n';

// 아이콘 폰트가 로드되기 전에 UI가 그려지면 탭바 아이콘이 빈칸으로 뜬다.
// 로드가 끝날 때까지 스플래시를 유지해 아이콘 누락(회귀)을 막는다.
SplashScreen.preventAutoHideAsync();

// 포그라운드에서도 알림 배너가 뜨게 한다. 모듈이 없는 빌드에서는 아무 일도 하지 않는다.
configureNotificationHandling();
// 데일리 넛지도 기동 때 한 번 맞춰 깐다 — 어제 예약분을 오늘 상태로 갱신한다(SOMA-444).
void syncDailyNudge();

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

/** 인증 → 동의 진입 → 이름 → pending 분석 순서로 최초 화면을 게이트한다. */
function RootNavigator() {
  const {
    status,
    user,
    consentEntry,
    profileSetupRequired,
  } = useAuth();
  const segments = useSegments();
  const pathname = usePathname();
  const currentRouteParams = useGlobalSearchParams<BootstrapRecoveryParams>();
  const {
    recoveryKey: currentRecoveryKey,
    sessionId: currentRecoverySessionId,
  } = currentRouteParams;
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
  const completedBootstrapRef = useRef<{
    sessionKey: string;
    route: Href;
  } | null>(null);
  const interruptedRouteRef = useRef<{
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

  useEffect(() => {
    const bootstrap = resolveBootstrapStep({
      authStatus: status,
      userId: user?.id ?? null,
      consentEntryStatus: consentEntry.status,
      profileSetupRequired,
      recoveryStatus: recoveryStatusForConsentGate(recovery, consentGate),
      recoveryOwner: recovery.owner,
      pending: recovery.pending,
    });
    const sessionKey =
      status === 'signedIn' && user
        ? `signedIn:${user.id}`
        : status === 'signedOut'
          ? 'signedOut'
          : null;
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
    const inAccountManagement = routeAllowedWhileConsentBlocked(
      segments as string[],
    );

    const rememberInterruptedRoute = () => {
      if (!sessionKey || inLogin || inConsent || inProfileName) return;
      if (interruptedRouteRef.current?.sessionKey === sessionKey) return;
      const params = Object.fromEntries(
        Object.entries(currentRouteParams).filter(([, value]) => value !== undefined),
      );
      interruptedRouteRef.current = {
        sessionKey,
        route: (Object.keys(params).length > 0
          ? { pathname, params }
          : pathname) as Href,
      };
    };

    if (bootstrap.stage === 'auth-gate') {
      if (bootstrap.route === '/login') interruptedRouteRef.current = null;
      if (bootstrap.route === '/login' && !inLogin) {
        router.replace('/login' as Href);
      }
      return;
    }
    if (bootstrap.stage === 'consent-gate') {
      completedBootstrapRef.current = null;
      rememberInterruptedRoute();
      if (bootstrap.route === '/consent' && !inConsent) {
        router.replace('/consent' as Href);
      }
      return;
    }
    if (bootstrap.stage === 'blocked-gate') {
      completedBootstrapRef.current = null;
      if (!inAccountManagement) {
        rememberInterruptedRoute();
        router.replace('/settings' as Href);
      }
      return;
    }
    if (bootstrap.stage === 'profile-gate') {
      completedBootstrapRef.current = null;
      if (!inProfileName) router.replace('/profile-name' as Href);
      return;
    }
    if (bootstrap.stage === 'pending-recovery' || !bootstrap.route || !sessionKey) {
      return;
    }

    const interruptedRoute =
      interruptedRouteRef.current?.sessionKey === sessionKey
        ? interruptedRouteRef.current.route
        : null;
    const targetRoute = resolvePostConsentRoute(
      bootstrap.route,
      interruptedRoute,
    ) as Href;
    if (interruptedRoute) interruptedRouteRef.current = null;

    const completed = completedBootstrapRef.current;
    if (completed?.sessionKey === sessionKey) {
      if (inLogin || inConsent || inProfileName) {
        router.replace(completed.route);
      }
      return;
    }

    if (targetRoute !== bootstrap.route) {
      router.replace(targetRoute);
      completedBootstrapRef.current = { sessionKey, route: targetRoute };
      return;
    }

    if (typeof bootstrap.route === 'object') {
      if (
        resolveAnalyzingBootstrapRoute(
          pathname,
          {
            recoveryKey: currentRecoveryKey,
            sessionId: currentRecoverySessionId,
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
    status,
    user,
    consentEntry.status,
    profileSetupRequired,
    consentGate,
    recovery,
    segments,
    pathname,
    currentRecoveryKey,
    currentRecoverySessionId,
    currentRouteParams,
    router,
  ]);

  useEffect(() => {
    const consentScreenReady =
      consentEntry.status === 'error' ||
      consentEntry.status === 'decision_required' ||
      consentEntry.status === 'blocked';
    const readyToShow =
      status === 'signedOut' ||
      (status === 'signedIn' &&
        Boolean(user) &&
        (consentScreenReady ||
          (consentEntry.status === 'allowed' &&
            (profileSetupRequired ||
              (recovery.status === 'ready' && recovery.owner === user?.id)))));
    if (readyToShow) {
      void SplashScreen.hideAsync();
    }
  }, [
    status,
    user,
    consentEntry.status,
    profileSetupRequired,
    recovery.status,
    recovery.owner,
  ]);

  if (status === 'loading') return null;

  return (
    <Stack>
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="consent" options={{ headerShown: false }} />
      <Stack.Screen name="profile-name" options={{ headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen
        name="delete-account"
        options={{ title: t('stack.withdraw'), headerBackTitle: t('stack.backToSettings') }}
      />
      <Stack.Screen name="upload" options={{ title: t('stack.upload') }} />
      <Stack.Screen name="record-video" options={{ title: t('record.screenTitle'), presentation: 'fullScreenModal' }} />
      <Stack.Screen name="analyzing" options={{ title: t('stack.analyzing') }} />
      <Stack.Screen name="coach" options={{ title: t('stack.coach') }} />
      <Stack.Screen name="report" options={{ title: t('stack.report') }} />
      {/* 아래 셋은 화면 안에 자체 헤더가 있다. 등록해 두지 않으면 기본 헤더가
          한 겹 더 붙어 '뒤로' 버튼이 두 개로 보인다. */}
      <Stack.Screen name="admissions/index" options={{ headerShown: false }} />
      <Stack.Screen name="admissions/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="community-post" options={{ headerShown: false }} />
      <Stack.Screen name="community-new" options={{ headerShown: false, presentation: 'modal' }} />
    </Stack>
  );
}

function ScreenTracker() {
  const segments = useSegments();
  useEffect(() => {
    logScreenView('/' + segments.join('/'));
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

  // Meta SDK 초기화(SOMA-481). iOS ATT 팝업은 앱이 활성 상태일 때만 뜨므로,
  // 아직 활성이 아니면 활성이 되는 순간까지 기다렸다가 한 번만 부른다.
  useEffect(() => {
    if (AppState.currentState === 'active') {
      void initMetaSdk();
      return;
    }
    const subscription = AppState.addEventListener('change', (next) => {
      if (next !== 'active') return;
      subscription.remove();
      void initMetaSdk();
    });
    return () => subscription.remove();
  }, []);

  if (!fontsLoaded) return null;

  return (
    <AuthProvider>
      <ThemeProvider value={theme}>
        <ScreenTracker />
        <RootNavigator />
        <StatusBar style="dark" />
      </ThemeProvider>
    </AuthProvider>
  );
}
