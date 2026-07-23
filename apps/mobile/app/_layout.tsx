import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack, useRouter, useSegments, type Href } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import 'react-native-reanimated';

import { logScreenView } from '@/lib/analytics';
import { pendingAnalysisStore } from '@/lib/analysis-storage';
import { AuthProvider, useAuth } from '@/lib/auth';
import {
  decideBootstrapRoute,
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
  const router = useRouter();
  const bootstrappedSessionRef = useRef<string | null>(null);
  const [recovery, setRecovery] = useState<{
    status: 'loading' | 'ready';
    owner: string | null;
    pending: PendingAnalysisHandle | null;
  }>({ status: 'loading', owner: null, pending: null });

  useEffect(() => {
    let active = true;
    if (status === 'loading') {
      setRecovery({ status: 'loading', owner: null, pending: null });
      return () => {
        active = false;
      };
    }
    if (status === 'signedOut' || !user) {
      setRecovery({ status: 'ready', owner: null, pending: null });
      return () => {
        active = false;
      };
    }
    setRecovery({ status: 'loading', owner: user.id, pending: null });
    void pendingAnalysisStore
      .loadForOwner(user.id)
      .then((pending) => {
        if (active) setRecovery({ status: 'ready', owner: user.id, pending });
      })
      .catch(() => {
        if (active) setRecovery({ status: 'ready', owner: user.id, pending: null });
      });
    return () => {
      active = false;
    };
  }, [status, user]);

  useEffect(() => {
    if (status === 'loading' || recovery.status === 'loading') return;
    const sessionKey = status === 'signedIn' ? `signedIn:${user?.id ?? ''}` : 'signedOut';
    // /login·/consent는 typedRoutes가 다음 dev 서버 실행 때 인식 — 그전까지 캐스트로 처리.
    const first = segments[0] as string;
    const inLogin = first === 'login';
    const inConsent = first === 'consent';
    const inAnalyzing = first === 'analyzing';

    if (bootstrappedSessionRef.current !== sessionKey) {
      const initialRoute = decideBootstrapRoute({
        authStatus: status,
        hasPendingConsents: consentRequired || pendingConsents.length > 0,
        recoveryStatus: recovery.status,
        pending: recovery.pending,
      });
      if (!initialRoute) return;
      bootstrappedSessionRef.current = sessionKey;
      if (typeof initialRoute === 'object') {
        if (!inAnalyzing) router.replace(initialRoute as Href);
      } else if (initialRoute === '/login') {
        if (!inLogin) router.replace(initialRoute as Href);
      } else if (initialRoute === '/consent') {
        if (!inConsent) router.replace(initialRoute as Href);
      } else if (inLogin || inConsent) {
        router.replace(initialRoute as Href);
      }
      return;
    }

    if (status === 'signedOut') {
      if (!inLogin) router.replace('/login' as Href);
      return;
    }
    if (consentRequired || pendingConsents.length > 0) {
      if (!inConsent) router.replace('/consent' as Href);
      return;
    }
    if (inLogin || inConsent) router.replace('/(tabs)');
  }, [
    status,
    user,
    pendingConsents,
    consentRequired,
    recovery,
    segments,
    router,
  ]);

  useEffect(() => {
    if (status !== 'loading' && recovery.status === 'ready') {
      void SplashScreen.hideAsync();
    }
  }, [status, recovery.status]);

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
  const [fontsLoaded] = useFonts(MaterialIcons.font);

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
