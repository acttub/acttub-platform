jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@/hooks/use-store-recovery', () => ({ useStoreRecovery: jest.fn() }));
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AppState, Platform } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getTrackingPermissionsAsync, requestTrackingPermissionsAsync } from 'expo-tracking-transparency';
import { TRACKING_INTRO_KEY } from '@/lib/tracking-intro';

import { flushPendingPushTokenDeletions, configureNotificationHandling, onPushTapped } from '@/lib/notifications';
import { sweepDeviceFiles } from '@/lib/account-files';
import { installNavigationGuard } from '@/lib/navigation-guard';
import { initCrashlytics, markScreen } from '@/lib/crashlytics';
import { initMetaSdk } from '@/lib/meta-events';
import { startSignupAttributionListener } from '@/lib/signup-attribution-runtime';
import { logEvent, logScreenView } from '@/lib/analytics';
import { postHog, syncPostHog } from '@/lib/posthog';
import { pendingAnalysisStore } from '@/lib/analysis-storage';
import { useAuth } from '@/lib/auth';
import RootLayout from '@/app/_layout';
import { markHomeReady, resetHomeReadyForTest } from '@/lib/launch-splash';

type AuthState = {
  status: 'loading' | 'signedIn' | 'signedOut';
  user: { id: string } | null;
  consentEntry: { status: string };
  profile: { status: string };
  signup: object | null;
  updateRequired: boolean;
};

const mockRouter = { replace: jest.fn(), push: jest.fn(), dismissAll: jest.fn(), canDismiss: jest.fn() };
const mockNav = { segments: ['(tabs)'] as string[], pathname: '/', params: {} as Record<string, string> };
let mockFontsLoaded = true;
jest.mock('expo-router', () => {
  const { Text, View } = require('react-native');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Stack = ({ screenOptions, children }: { screenOptions: any; children: any }) => (
    <View>
      {screenOptions.header ? (screenOptions.header({ options: {} }) as never) : <Text>네이티브 머리</Text>}
      {screenOptions.headerLeft ? (screenOptions.headerLeft() as never) : null}
      {children as never}
    </View>
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Stack.Screen = ({ name, options }: { name: string; options: any }) =>
    typeof options === 'function' ? <Text>{`${name} 제목 ${options({ route: {} }).title}`}</Text> : null;
  return {
    router: { tag: 'global-router' },
    Stack,
    useRouter: () => mockRouter,
    useSegments: () => mockNav.segments,
    usePathname: () => mockNav.pathname,
    useGlobalSearchParams: () => mockNav.params,
  };
});
jest.mock('@react-navigation/native', () => ({
  DefaultTheme: { colors: {} },
  ThemeProvider: ({ children }: { children: unknown }) => children,
  getFocusedRouteNameFromRoute: () => 'profile',
}));
jest.mock('expo-font', () => ({ useFonts: () => [mockFontsLoaded] }));
jest.mock('expo-splash-screen', () => ({ preventAutoHideAsync: jest.fn(), hideAsync: jest.fn() }));
jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));
jest.mock('react-native-reanimated', () => ({}));
jest.mock('@/lib/global-font', () => ({}));
jest.mock('@/lib/analytics', () => ({ logEvent: jest.fn(), logScreenView: jest.fn() }));
jest.mock('expo-tracking-transparency', () => ({
  getTrackingPermissionsAsync: jest.fn(),
  requestTrackingPermissionsAsync: jest.fn(),
}));
jest.mock('@/lib/meta-events', () => ({ initMetaSdk: jest.fn() }));
jest.mock('@/lib/posthog', () => ({ postHog: { touch: jest.fn() }, syncPostHog: jest.fn() }));
jest.mock('@/lib/signup-attribution-runtime', () => ({ startSignupAttributionListener: jest.fn() }));
jest.mock('@/lib/crashlytics', () => ({ initCrashlytics: jest.fn(), markScreen: jest.fn() }));
jest.mock('@/lib/navigation-guard', () => ({ installNavigationGuard: jest.fn() }));
jest.mock('@/lib/api', () => ({ api: { getVoiceModel: jest.fn() } }));
jest.mock('@/lib/reading/tts/assets', () => ({ setVoiceModelSource: jest.fn() }));
jest.mock('@/lib/account-files', () => ({ sweepDeviceFiles: jest.fn() }));
jest.mock('@/lib/analysis-storage', () => ({ pendingAnalysisStore: { loadForOwner: jest.fn() } }));
jest.mock('@/lib/notifications', () => ({
  configureNotificationHandling: jest.fn(),
  flushPendingPushTokenDeletions: jest.fn(),
  onPushTapped: jest.fn(),
  capturePushOpen: jest.fn(),
  recordColdStartPushOpen: jest.fn(() => Promise.resolve()),
  setPushOpenSignedIn: jest.fn(),
}));
jest.mock('@/lib/auth', () => ({ AuthProvider: ({ children }: { children: unknown }) => children, useAuth: jest.fn() }));
jest.mock('@/components/app-header', () => ({ AppHeader: () => require('react').createElement(require('react-native').Text, null, '앱 머리') }));
jest.mock('@/components/header-back', () => ({ HeaderBack: () => require('react').createElement(require('react-native').Text, null, '뒤로 꺾쇠') }));
jest.mock('@/components/spotlight-guide', () => ({ SpotlightHost: () => null }));
// 진입 화면은 onShown 을 부르지 않는다 — 여기서 hideAsync 는 진입 화면을 닫았다는 뜻이다.
jest.mock('@/components/launch-splash-screen', () => ({ LaunchSplashScreen: () => require('react').createElement(require('react-native').Text, null, '진입 화면') }));
jest.mock('@/components/reconsent-popup', () => ({
  ReconsentPopup: ({ visible }: { visible: boolean }) =>
    visible ? require('react').createElement(require('react-native').Text, null, '재동의 팝업') : null,
}));

const loadForOwner = pendingAnalysisStore.loadForOwner as jest.Mock;
let pushListener: ((data: unknown) => void) | null = null;
let auth: AuthState;

const signedIn = (overrides: Partial<AuthState> = {}): AuthState => ({
  status: 'signedIn',
  user: { id: 'u1' },
  consentEntry: { status: 'allowed' },
  profile: { status: 'complete' },
  signup: null,
  updateRequired: false,
  ...overrides,
});

const startupCalls = {
  prevent: (SplashScreen.preventAutoHideAsync as jest.Mock).mock.calls.length,
  configure: (configureNotificationHandling as jest.Mock).mock.calls.length,
  flush: (flushPendingPushTokenDeletions as jest.Mock).mock.calls.length,
  sweep: (sweepDeviceFiles as jest.Mock).mock.calls.length,
  guard: [...(installNavigationGuard as jest.Mock).mock.calls],
};

beforeEach(() => {
  jest.clearAllMocks();
  // 게이트 테스트는 홈이 이미 준비된 상태로 본다. 홈을 기다리는 로고는 아래 「홈을 기다리는 로고」에서 따로 본다.
  resetHomeReadyForTest();
  markHomeReady();
  mockFontsLoaded = true;
  mockNav.segments = ['(tabs)'];
  mockNav.pathname = '/';
  mockNav.params = {};
  mockRouter.canDismiss.mockReturnValue(false);
  auth = signedIn();
  (useAuth as jest.Mock).mockImplementation(() => auth);
  loadForOwner.mockResolvedValue(null);
  (onPushTapped as jest.Mock).mockImplementation((fn: (data: unknown) => void) => {
    pushListener = fn;
    return () => undefined;
  });
  setAppState('active');
});

const originalAppState = Object.getOwnPropertyDescriptor(AppState, 'currentState')!;
function setAppState(value: string) {
  Object.defineProperty(AppState, 'currentState', { value, configurable: true, writable: true });
}

afterEach(() => {
  jest.restoreAllMocks();
  Object.defineProperty(AppState, 'currentState', originalAppState);
});

async function renderLayout() {
  const view = await render(<RootLayout />);
  await act(async () => undefined);
  return view;
}

async function update(next: Partial<AuthState>, view: Awaited<ReturnType<typeof render>>) {
  auth = { ...auth, ...next };
  await view.rerender(<RootLayout />);
  await act(async () => undefined);
}

test('앱을 열면 스플래시를 붙잡고 알림·남은 파일·이중 이동 방지를 준비한다', () => {
  expect(startupCalls).toEqual({ prevent: 1, configure: 1, flush: 1, sweep: 1, guard: [[{ tag: 'global-router' }]] });
});

test('크래시 수집·가입 귀속·메타 SDK를 켜고 지금 화면을 기록한다', async () => {
  mockNav.segments = ['(tabs)', 'profile'];
  await renderLayout();

  expect(initCrashlytics).toHaveBeenCalledTimes(1);
  expect(startSignupAttributionListener).toHaveBeenCalledTimes(1);
  expect(initMetaSdk).toHaveBeenCalledTimes(1);
  expect(logScreenView).toHaveBeenCalledWith('/(tabs)/profile');
  expect(markScreen).toHaveBeenCalledWith('/(tabs)/profile');
});

test('앱이 아직 활성이 아니면 활성이 되는 순간 한 번만 메타 SDK를 켠다', async () => {
  setAppState('background');
  const remove = jest.fn();
  let onChange: ((state: string) => void) | undefined;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, fn) => {
    onChange = fn as (state: string) => void;
    return { remove } as never;
  });
  const view = await renderLayout();

  expect(initMetaSdk).not.toHaveBeenCalled();
  onChange?.('inactive');
  expect(initMetaSdk).not.toHaveBeenCalled();
  onChange?.('active');
  expect(initMetaSdk).toHaveBeenCalledTimes(1);
  expect(remove).toHaveBeenCalledTimes(1);

  await view.unmount();
  expect(remove).toHaveBeenCalledTimes(2);
});

test('글꼴을 읽기 전에는 화면을 그리지 않는다', async () => {
  mockFontsLoaded = false;
  await renderLayout();
  expect(screen.queryByText('앱 머리')).not.toBeOnTheScreen();
  expect(logScreenView).not.toHaveBeenCalled();
  expect(initCrashlytics).toHaveBeenCalledTimes(1);
});

test('손을 뗄 때마다 탭 기록으로 넘긴다', async () => {
  await renderLayout();
  const event = { nativeEvent: { pageX: 1, pageY: 2 } };
  await fireEvent(screen.getByText('앱 머리'), 'touchEndCapture', event);
  expect(postHog.touch).toHaveBeenCalledWith(event);
});

describe('머리', () => {
  test('iOS는 직접 그린 머리와 뒤로 버튼을 쓴다', async () => {
    await renderLayout();
    expect(screen.getByText('앱 머리')).toBeOnTheScreen();
    expect(screen.getByText('뒤로 꺾쇠')).toBeOnTheScreen();
    expect(screen.getByText('(tabs) 제목 프로필')).toBeOnTheScreen();
  });

  test('안드로이드는 네이티브 머리를 쓴다', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    await renderLayout();
    expect(screen.getByText('네이티브 머리')).toBeOnTheScreen();
    expect(screen.queryByText('뒤로 꺾쇠')).not.toBeOnTheScreen();
  });
});

describe('게이트', () => {
  test('인증을 읽는 중에는 아무것도 그리거나 옮기지 않는다', async () => {
    auth = signedIn({ status: 'loading', user: null });
    const view = await renderLayout();

    expect(screen.queryByText('앱 머리')).not.toBeOnTheScreen();
    expect(mockRouter.replace).not.toHaveBeenCalled();
    expect(SplashScreen.hideAsync).not.toHaveBeenCalled();

    await update({ status: 'signedOut' }, view);
    expect(mockRouter.replace).toHaveBeenCalledWith('/login');
    expect(screen.getByText('앱 머리')).toBeOnTheScreen();
  });

  test('업데이트가 필요하면 업데이트 안내로 보내고, 이미 거기면 그대로 둔다', async () => {
    auth = signedIn({ status: 'loading', updateRequired: true });
    const view = await renderLayout();

    expect(mockRouter.replace).toHaveBeenCalledWith('/update-required');
    expect(SplashScreen.hideAsync).toHaveBeenCalled();

    mockNav.segments = ['update-required'];
    mockRouter.replace.mockClear();
    await update({}, view);
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  test('로그아웃 상태면 쌓인 화면을 닫고 로그인으로 보낸다', async () => {
    mockRouter.canDismiss.mockReturnValue(true);
    auth = signedIn({ status: 'signedOut', user: null });
    await renderLayout();

    expect(mockRouter.dismissAll).toHaveBeenCalled();
    expect(mockRouter.replace).toHaveBeenCalledWith('/login');
    expect(SplashScreen.hideAsync).toHaveBeenCalled();
  });

  test('닫을 화면이 없으면 로그인으로 바꾸기만 하고, 로그인 화면이면 그대로 둔다', async () => {
    auth = signedIn({ status: 'signedOut', user: null });
    const view = await renderLayout();
    expect(mockRouter.dismissAll).not.toHaveBeenCalled();
    expect(mockRouter.replace).toHaveBeenCalledWith('/login');

    mockNav.segments = ['login'];
    mockRouter.replace.mockClear();
    await update({}, view);
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  test('처음 온 신원은 가입 동의로 보낸다', async () => {
    auth = signedIn({ status: 'signedOut', user: null, signup: { documents: [] } });
    const view = await renderLayout();
    expect(mockRouter.replace).toHaveBeenCalledWith('/consent');

    mockNav.segments = ['consent'];
    mockRouter.replace.mockClear();
    await update({}, view);
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  test('재동의가 필요하면 홈을 깔고 재동의 팝업을 띄운다', async () => {
    mockNav.segments = ['login'];
    auth = signedIn({ consentEntry: { status: 'decision_required' } });
    const view = await renderLayout();

    expect(mockRouter.replace).toHaveBeenCalledWith('/(tabs)');
    expect(screen.getByText('재동의 팝업')).toBeOnTheScreen();
    expect(syncPostHog).toHaveBeenCalledWith('decision_required');
    expect(SplashScreen.hideAsync).toHaveBeenCalled();

    await update({ consentEntry: { status: 'checking' } }, view);
    expect(screen.getByText('재동의 팝업')).toBeOnTheScreen();
    await update({ consentEntry: { status: 'allowed' } }, view);
    expect(screen.queryByText('재동의 팝업')).not.toBeOnTheScreen();
  });

  test('동의 판정을 읽는 중에는 팝업도 이동도 없다', async () => {
    auth = signedIn({ consentEntry: { status: 'checking' } });
    const view = await renderLayout();
    expect(screen.queryByText('재동의 팝업')).not.toBeOnTheScreen();
    expect(mockRouter.replace).not.toHaveBeenCalled();
    expect(SplashScreen.hideAsync).not.toHaveBeenCalled();

    await update({ consentEntry: { status: 'decision_required' } }, view);
    expect(screen.getByText('재동의 팝업')).toBeOnTheScreen();
  });

  test('동의 판정을 못 읽었으면 팝업을 띄우되 다른 화면에서는 옮기지 않는다', async () => {
    auth = signedIn({ consentEntry: { status: 'error' } });
    await renderLayout();
    expect(screen.getByText('재동의 팝업')).toBeOnTheScreen();
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  test('프로필이 비었으면 프로필 설정으로 보내고, 이미 거기면 그대로 둔다', async () => {
    auth = signedIn({ profile: { status: 'required' } });
    const view = await renderLayout();
    expect(mockRouter.replace).toHaveBeenCalledWith('/profile-name');
    expect(SplashScreen.hideAsync).toHaveBeenCalled();

    mockNav.segments = ['profile-name'];
    mockRouter.replace.mockClear();
    await update({}, view);
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  test('프로필을 읽는 중에는 스플래시를 내리지 않는다', async () => {
    auth = signedIn({ profile: { status: 'checking' } });
    const view = await renderLayout();
    expect(SplashScreen.hideAsync).not.toHaveBeenCalled();
    expect(mockRouter.replace).not.toHaveBeenCalled();

    await update({ profile: { status: 'complete' } }, view);
    expect(SplashScreen.hideAsync).toHaveBeenCalled();
  });

  test('프로필을 못 읽었으면 프로필 화면에서 다시 읽게 한다', async () => {
    auth = signedIn({ profile: { status: 'error' } });
    await renderLayout();
    expect(mockRouter.replace).toHaveBeenCalledWith('/profile-name');
    expect(SplashScreen.hideAsync).toHaveBeenCalled();
  });

  test('모두 통과하면 로그인 화면에서 홈으로 한 번 보내고, 다시 로그인 화면에 오면 홈으로 돌린다', async () => {
    mockNav.segments = ['login'];
    const view = await renderLayout();

    expect(loadForOwner).toHaveBeenCalledWith('u1');
    expect(mockRouter.replace).toHaveBeenCalledWith('/(tabs)');
    expect(SplashScreen.hideAsync).toHaveBeenCalled();

    mockNav.segments = ['(tabs)'];
    mockRouter.replace.mockClear();
    await update({}, view);
    expect(mockRouter.replace).not.toHaveBeenCalled();

    mockNav.segments = ['consent'];
    await update({}, view);
    expect(mockRouter.replace).toHaveBeenCalledWith('/(tabs)');
  });

  test('홈에서 시작하면 옮기지 않는다', async () => {
    await renderLayout();
    expect(mockRouter.replace).not.toHaveBeenCalled();
    expect(SplashScreen.hideAsync).toHaveBeenCalled();
  });

  test('끝나지 않은 분석이 있으면 분석 화면으로 되살린다', async () => {
    loadForOwner.mockResolvedValue({ key: 'k1', record: { practice_id: 'p1' } });
    await renderLayout();

    expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/coach', params: { recoveryKey: 'k1', practiceId: 'p1' } });
  });

  test('이미 그 분석 화면이면 다시 보내지 않는다', async () => {
    loadForOwner.mockResolvedValue({ key: 'k1', record: { practice_id: 'p1' } });
    mockNav.pathname = '/coach';
    mockNav.params = { recoveryKey: 'k1', practiceId: 'p1' };
    await renderLayout();

    expect(mockRouter.replace).not.toHaveBeenCalled();
    expect(SplashScreen.hideAsync).toHaveBeenCalled();
  });

  test('남은 분석을 못 읽으면 없는 것으로 보고 홈으로 간다', async () => {
    mockNav.segments = ['login'];
    loadForOwner.mockRejectedValue(new Error('storage'));
    await renderLayout();
    expect(mockRouter.replace).toHaveBeenCalledWith('/(tabs)');
  });

  test('다른 계정으로 바뀌면 그 계정의 남은 분석을 다시 확인한다', async () => {
    mockNav.segments = ['login'];
    const view = await renderLayout();
    expect(mockRouter.replace).toHaveBeenCalledWith('/(tabs)');

    loadForOwner.mockResolvedValue({ key: 'k2', record: { practice_id: 'p9' } });
    mockRouter.replace.mockClear();
    await update({ user: { id: 'u2' } }, view);

    expect(loadForOwner).toHaveBeenLastCalledWith('u2');
    expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/coach', params: { recoveryKey: 'k2', practiceId: 'p9' } });
  });

  test('계정을 읽기 전에 사용자 정보가 없으면 기다린다', async () => {
    auth = signedIn({ user: null });
    const view = await renderLayout();
    expect(mockRouter.replace).not.toHaveBeenCalled();
    expect(loadForOwner).not.toHaveBeenCalled();

    await update({ user: { id: 'u1' } }, view);
    expect(loadForOwner).toHaveBeenCalledWith('u1');
  });

  test.each([
    ['결과', (settle: { resolve: (v: unknown) => void }) => settle.resolve({ key: 'k1', record: { practice_id: 'p1' } })],
    ['실패', (settle: { reject: (e: unknown) => void }) => settle.reject(new Error('late'))],
  ])('분석 확인이 끝나기 전에 로그아웃하면 늦은 %s를 버린다', async (_name, finish) => {
    const settle = {} as { resolve: (v: unknown) => void; reject: (e: unknown) => void };
    loadForOwner.mockReturnValue(
      new Promise((resolve, reject) => {
        settle.resolve = resolve;
        settle.reject = reject;
      }),
    );
    const view = await renderLayout();

    await update({ status: 'signedOut', user: null }, view);
    await act(async () => finish(settle));

    expect(mockRouter.replace).toHaveBeenCalledWith('/login');
    expect(mockRouter.replace).not.toHaveBeenCalledWith(expect.objectContaining({ pathname: '/coach' }));
  });
});

describe('홈을 기다리는 로고', () => {
  beforeEach(() => {
    resetHomeReadyForTest();
  });

  test('홈으로 들어가면 홈이 첫 데이터를 받을 때까지 로고를 유지한다', async () => {
    await renderLayout();
    expect(SplashScreen.hideAsync).not.toHaveBeenCalled();
    expect(screen.getByText('진입 화면')).toBeOnTheScreen();

    await act(async () => markHomeReady());
    expect(SplashScreen.hideAsync).toHaveBeenCalled();
    expect(screen.queryByText('진입 화면')).not.toBeOnTheScreen();
  });

  test('홈이 3초 안에 준비되지 않으면 로고를 닫는다', async () => {
    jest.useFakeTimers();
    try {
      await renderLayout();
      expect(SplashScreen.hideAsync).not.toHaveBeenCalled();
      await act(async () => {
        jest.advanceTimersByTime(3000);
      });
      expect(SplashScreen.hideAsync).toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  test('홈이 아닌 화면으로 가면 기다리지 않는다', async () => {
    mockNav.pathname = '/analyzing';
    await renderLayout();
    expect(SplashScreen.hideAsync).toHaveBeenCalled();
  });

  test('로그아웃 상태면 기다리지 않는다', async () => {
    auth = signedIn({ status: 'signedOut', user: null });
    await renderLayout();
    expect(SplashScreen.hideAsync).toHaveBeenCalled();
  });
});

describe('푸시를 누르면', () => {
  test('저녁 리마인드는 홈을 연다', async () => {
    await renderLayout();
    pushListener?.({ kind: 'evening_reminder' });
    expect(mockRouter.replace).toHaveBeenCalledWith('/(tabs)');
  });

  test('안 읽은 대본 알림은 그 대본을 찾아 여는 화면으로 가고 누른 것을 남긴다(SOMA-862)', async () => {
    await renderLayout();
    const id = '12345678-1234-1234-1234-123456789abc';
    pushListener?.({ kind: 'evening_reminder', reminder_kind: 'unread_script', script_id: id, template_id: 'unread.a' });
    expect(mockRouter.replace).toHaveBeenCalledWith(`/reminder-open?kind=unread_script&id=${id}`);
    expect(logEvent).toHaveBeenCalledWith('reminder_open', { reminder_kind: 'unread_script', template_id: 'unread.a', target: 'resolve' });
  });

  test('챌린지 알림은 알림함을 연다', async () => {
    await renderLayout();
    pushListener?.({ kind: 'challenge_notification', group_key: 'g1' });
    expect(mockRouter.push).toHaveBeenCalledWith('/notifications');
  });

  test('모르는 알림은 무시한다', async () => {
    await renderLayout();
    pushListener?.({ kind: 'something_else' });
    pushListener?.(null);
    expect(mockRouter.push).not.toHaveBeenCalled();
    expect(mockRouter.replace).not.toHaveBeenCalled();

    pushListener?.({ kind: 'challenge_notification', notification_id: 'x1' });
    expect(mockRouter.push).toHaveBeenCalledWith('/notifications');
  });
});

// SDK 경계만 대체하고 실제 사전 안내·저장소·Modal 연결을 함께 검증한다.
describe('추적 허용 전 안내', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.replaceProperty(Platform, 'OS', 'ios');
    (getTrackingPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'undetermined' });
    (requestTrackingPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'denied' });
    (initMetaSdk as jest.Mock).mockImplementation(async (beforeRequest: () => Promise<void>) => {
      await beforeRequest();
      await requestTrackingPermissionsAsync();
    });
  });

  afterEach(() => {
    (initMetaSdk as jest.Mock).mockReset();
  });

  test('iOS 미결정이면 설명 화면 없이 바로 시스템 추적 팝업만 요청한다(pen S1.2)', async () => {
    await renderLayout();
    expect(screen.queryByText('Acttub를 어떻게 찾아오셨나요?')).not.toBeOnTheScreen();
    expect(getTrackingPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(requestTrackingPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  test('Android에서는 안내와 상태 조회 없이 기존 요청을 이어 간다', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    await renderLayout();
    expect(screen.queryByText('Acttub를 어떻게 찾아오셨나요?')).not.toBeOnTheScreen();
    expect(getTrackingPermissionsAsync).not.toHaveBeenCalled();
    expect(requestTrackingPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });

  test('iOS에서 이미 안내를 본 기기면 다시 띄우지 않고 요청한다', async () => {
    await AsyncStorage.setItem(TRACKING_INTRO_KEY, '1');
    await renderLayout();
    expect(getTrackingPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Acttub를 어떻게 찾아오셨나요?')).not.toBeOnTheScreen();
    expect(requestTrackingPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  test.each(['granted', 'denied'])('iOS 권한이 %s이면 안내를 건너뛴다', async (status) => {
    (getTrackingPermissionsAsync as jest.Mock).mockResolvedValue({ status });
    await renderLayout();
    expect(screen.queryByText('Acttub를 어떻게 찾아오셨나요?')).not.toBeOnTheScreen();
    expect(requestTrackingPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });
});
