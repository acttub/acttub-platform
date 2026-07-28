import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack, useRouter, useSegments, type Href } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import 'react-native-reanimated';

import '@/lib/global-font';
import { logScreenView } from '@/lib/analytics';
import { AuthProvider, useAuth } from '@/lib/auth';
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
  const { status, pendingConsents } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (status === 'loading') return;
    // /login·/consent는 typedRoutes가 다음 dev 서버 실행 때 인식 — 그전까지 캐스트로 처리.
    const first = segments[0] as string;
    const inLogin = first === 'login';
    const inConsent = first === 'consent';
    if (status === 'signedOut') {
      if (!inLogin) router.replace('/login' as Href);
      return;
    }
    // signedIn — 필수 약관이 남아있으면 약관 화면으로.
    if (pendingConsents.length > 0) {
      if (!inConsent) router.replace('/consent' as Href);
      return;
    }
    if (inLogin || inConsent) router.replace('/(tabs)');
  }, [status, pendingConsents, segments, router]);

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

/** 폰트와 인증 상태가 모두 준비되면 스플래시를 내린다. */
function SplashGate() {
  const { status } = useAuth();
  useEffect(() => {
    if (status !== 'loading') SplashScreen.hideAsync();
  }, [status]);
  return null;
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    ...MaterialIcons.font,
    Pretendard: require('@/assets/fonts/PretendardVariable.ttf'),
  });

  if (!fontsLoaded) return null;

  return (
    <AuthProvider>
      <ThemeProvider value={theme}>
        <SplashGate />
        <ScreenTracker />
        <RootNavigator />
        <StatusBar style="dark" />
      </ThemeProvider>
    </AuthProvider>
  );
}
