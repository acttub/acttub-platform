import Feather from '@expo/vector-icons/Feather';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
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
import 'react-native-reanimated';

import '@/lib/global-font';
import { logScreenView } from '@/lib/analytics';
import { pendingAnalysisStore } from '@/lib/analysis-storage';
import { AuthProvider, useAuth } from '@/lib/auth';
import {
  recoveryStatusForConsentGate,
  resolveAnalyzingBootstrapRoute,
  resolveBootstrapStep,
  type BootstrapRecoveryParams,
  type BootstrapRoute,
  type PendingAnalysisHandle,
} from '@/lib/pending-analysis';
import { palette } from '@/constants/palette';

// 아이콘 폰트가 로드되기 전에 UI가 그려지면 탭바 아이콘이 빈칸으로 뜬다.
// 로드가 끝날 때까지 스플래시를 유지해 아이콘 누락(회귀)을 막는다.
SplashScreen.preventAutoHideAsync();

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

/** 로그인 여부에 따라 로그인 화면 ↔ 앱을 게이트한다. */
function RootNavigator() {
  const { status, user, pendingConsents, consentRequired } = useAuth();
  const segments = useSegments();
  const pathname = usePathname();
  const {
    recoveryKey: currentRecoveryKey,
    sessionId: currentRecoverySessionId,
  } = useGlobalSearchParams<BootstrapRecoveryParams>();
  const router = useRouter();
  const hasPendingConsents = consentRequired || pendingConsents.length > 0;
  const consentGateRef = useRef({
    active: hasPendingConsents,
    generation: 0,
  });
  if (consentGateRef.current.active !== hasPendingConsents) {
    consentGateRef.current = {
      active: hasPendingConsents,
      generation: consentGateRef.current.generation + 1,
    };
  }
  const consentGate = consentGateRef.current.generation;
  const completedBootstrapRef = useRef<{
    sessionKey: string;
    route: BootstrapRoute;
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
      hasPendingConsents,
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

    if (bootstrap.stage === 'auth-gate') {
      if (bootstrap.route === '/login' && !inLogin) {
        router.replace('/login' as Href);
      }
      return;
    }
    if (bootstrap.stage === 'consent-gate') {
      completedBootstrapRef.current = null;
      if (!inConsent) router.replace('/consent' as Href);
      return;
    }
    if (bootstrap.stage === 'pending-recovery' || !bootstrap.route || !sessionKey) {
      return;
    }

    const completed = completedBootstrapRef.current;
    if (completed?.sessionKey === sessionKey) {
      if (inLogin || inConsent) router.replace(completed.route as Href);
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
    } else if (inLogin || inConsent) {
      router.replace(bootstrap.route as Href);
    }
    completedBootstrapRef.current = {
      sessionKey,
      route: bootstrap.route,
    };
  }, [
    status,
    user,
    pendingConsents,
    consentRequired,
    recovery,
    segments,
    pathname,
    currentRecoveryKey,
    currentRecoverySessionId,
    router,
  ]);

  useEffect(() => {
    const readyToShow =
      status === 'signedOut' ||
      (status === 'signedIn' &&
        Boolean(user) &&
        (hasPendingConsents ||
          (recovery.status === 'ready' && recovery.owner === user?.id)));
    if (readyToShow) {
      void SplashScreen.hideAsync();
    }
  }, [
    status,
    user,
    pendingConsents,
    consentRequired,
    recovery.status,
    recovery.owner,
  ]);

  if (status === 'loading') return null;

  return (
    <Stack>
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="consent" options={{ headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="upload" options={{ title: '영상 올리기' }} />
      <Stack.Screen name="analyzing" options={{ title: '분석 중' }} />
      <Stack.Screen name="coach" options={{ title: '코치와 되짚기' }} />
      <Stack.Screen name="report" options={{ title: '피드백 카드' }} />
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
    ...MaterialIcons.font,
    ...Feather.font,
    // 굵기별 static 서브셋 — 가변폰트는 안드로이드에서 fontWeight가 안 먹는다([[global-font]]).
    Pretendard: require('@/assets/fonts/Pretendard-Regular.subset.ttf'),
    'Pretendard-SemiBold': require('@/assets/fonts/Pretendard-SemiBold.subset.ttf'),
    'Pretendard-Bold': require('@/assets/fonts/Pretendard-Bold.subset.ttf'),
  });

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
