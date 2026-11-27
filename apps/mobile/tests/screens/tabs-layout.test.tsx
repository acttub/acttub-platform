import { act, fireEvent, render, screen, within } from '@testing-library/react-native';

import TabLayout from '@/app/(tabs)/_layout';
import { logEvent } from '@/lib/analytics';
import { api } from '@/lib/api';
import { rememberLastTab } from '@/lib/last-tab';
import { setFirstTimeState } from '@/lib/practice/first-time';

const mockRouter = { push: jest.fn() };

// 탭 내비게이터 대신, 받은 화면 설정대로 탭을 그리고 누르면 그 탭이 활성이 되는 최소 탭바.
// 누르면 screenListeners 의 tabPress, 활성이 바뀌면 focus 를 부른다(react-navigation 과 같은 순서).
// React·react-native 는 그릴 때 읽는다 — 안드로이드 시험이 따로 읽은 모듈 묶음에서도 같은 React 를 쓰게 한다.
jest.mock('expo-router', () => {
  function Tabs({
    screenOptions,
    screenListeners,
    children,
  }: {
    screenOptions: Record<string, any>;
    screenListeners?: (props: { route: { name: string } }) => Record<string, () => void>;
    children: unknown;
  }) {
    const { Children, useState } = require('react');
    const { Text, View } = require('react-native');
    const screens = (Children.toArray(children) as { props: { name: string; options: Record<string, any> } }[])
      .map((child) => child.props)
      .filter((props) => props.options.href !== null);
    const [focused, setFocused] = useState(screens[0].name);
    const barStyle = screenOptions.tabBarStyle;
    return (
      <View>
        <Text>{`탭바 ${barStyle?.display === 'none' ? '숨김' : '보임'}`}</Text>
        {screens.map(({ name, options }) => {
          const on = focused === name;
          const Icon = options.tabBarIcon;
          const Button = options.tabBarButton;
          const listeners = screenListeners?.({ route: { name } }) ?? {};
          return (
            <Button
              key={name}
              accessibilityRole="tab"
              accessibilityLabel={options.tabBarAccessibilityLabel}
              accessibilityState={{ selected: on }}
              onPress={() => {
                listeners.tabPress?.();
                setFocused(name);
                listeners.focus?.();
              }}>
              <Icon focused={on} color={on ? screenOptions.tabBarActiveTintColor : screenOptions.tabBarInactiveTintColor} />
            </Button>
          );
        })}
      </View>
    );
  }
  Tabs.Screen = () => null;
  return { Tabs, useRouter: () => mockRouter, usePathname: () => '/' };
});
// 진동 버튼 대신 받은 속성을 그대로 넘기는 버튼 — 탭마다 붙인 이름(ph-label)을 볼 수 있게.
jest.mock('@/components/haptic-tab', () => ({
  HapticTab: (props: Record<string, unknown>) => {
    const { Pressable } = require('react-native');
    return <Pressable {...props} />;
  },
}));
jest.mock('@expo/vector-icons/Ionicons', () => ({ name }: { name: string }) => {
  const { Text } = require('react-native');
  return <Text>{`아이콘 ${name}`}</Text>;
});
jest.mock('@expo/vector-icons/Feather', () => ({ name }: { name: string }) => {
  const { Text } = require('react-native');
  return <Text>{`아이콘 ${name}`}</Text>;
});
jest.mock('@/lib/api', () => ({ api: { unreadNotificationCount: jest.fn() } }));
jest.mock('@/lib/analytics', () => ({ logEvent: jest.fn() }));
jest.mock('@/lib/last-tab', () => ({
  ...jest.requireActual('@/lib/last-tab'),
  rememberLastTab: jest.fn(async () => undefined),
}));
// 기록 읽기·탭 위 덮개는 따로 시험한다(tests/screens/tab-launch.test.tsx).
jest.mock('@/hooks/use-practice-records', () => ({ PracticeRecordsProvider: ({ children }: { children: unknown }) => children }));
jest.mock('@/components/tab-launch-overlays', () => ({ TabLaunchOverlays: () => null }));

const unreadCount = api.unreadNotificationCount as jest.Mock;
const TAB_NAMES = ['리딩', '코칭', '커뮤니티', '챌린지', '프로필'];

beforeEach(() => {
  jest.clearAllMocks();
  unreadCount.mockResolvedValue({ count: 0 });
});

test('하단 바는 리딩·코칭·커뮤니티·챌린지·프로필이고 홈(index)·기록·예전 촬영 자리는 탭바에서 뺀다(SOMA-1120)', async () => {
  await render(<TabLayout />);

  expect(screen.getAllByRole('tab').map((tab) => tab.props.accessibilityLabel)).toEqual(TAB_NAMES);
  expect(screen.queryByRole('tab', { name: '홈' })).not.toBeOnTheScreen();
});

test('아이콘만 있는 탭마다 읽어 줄 이름과 누름 기록 이름을 단다 — 챌린지는 예전 이름(tab_challenge) 그대로', async () => {
  await render(<TabLayout />);

  expect(screen.getAllByRole('tab').map((tab) => tab.props['ph-label'])).toEqual([
    'tab_reading',
    'tab_coaching',
    'tab_community',
    'tab_challenge',
    'tab_profile',
  ]);
});

test('탭을 누르면 tab_select { tab } 을 남기고, 보이는 탭을 마지막 탭으로 기억한다', async () => {
  await render(<TabLayout />);

  await fireEvent.press(screen.getByRole('tab', { name: '커뮤니티' }));
  expect(logEvent).toHaveBeenCalledWith('tab_select', { tab: 'community' });
  expect(rememberLastTab).toHaveBeenLastCalledWith('community');

  await fireEvent.press(screen.getByRole('tab', { name: '챌린지' }));
  expect(logEvent).toHaveBeenLastCalledWith('tab_select', { tab: 'challenges' });
  expect(rememberLastTab).toHaveBeenLastCalledWith('challenges');
});

test('iOS 는 활성·비활성 모두 윤곽 아이콘이고 탭 이름 글자는 어느 탭에도 쓰지 않는다(SOMA-838)', async () => {
  await render(<TabLayout />);

  expect(screen.getByText('아이콘 chatbubble-outline')).toBeOnTheScreen();
  expect(screen.getByText('아이콘 book-outline')).toBeOnTheScreen();
  expect(screen.getByText('아이콘 users')).toBeOnTheScreen();
  expect(screen.getByText('아이콘 trophy-outline')).toBeOnTheScreen();
  for (const name of TAB_NAMES) expect(screen.queryByText(name)).not.toBeOnTheScreen();

  await fireEvent.press(screen.getByRole('tab', { name: '코칭' }));
  for (const name of TAB_NAMES) expect(screen.queryByText(name)).not.toBeOnTheScreen();
  expect(screen.getByRole('tab', { name: '코칭', selected: true })).toBeOnTheScreen();
  expect(screen.getByRole('tab', { name: '리딩', selected: false })).toBeOnTheScreen();
});

test('첫 사용자여도 탭바를 숨기지 않는다 — 홈이 없어 숨기면 다른 탭으로 갈 길이 없다(SOMA-1120)', async () => {
  await render(<TabLayout />);
  await act(async () => setFirstTimeState('first'));
  expect(screen.getByText('탭바 보임')).toBeOnTheScreen();
  await act(async () => setFirstTimeState('unknown'));
});

test('읽지 않은 알림 묶음이 있으면 커뮤니티 탭에 그 수를 단다', async () => {
  unreadCount.mockResolvedValue({ count: 120 });

  await render(<TabLayout />);

  expect(await within(screen.getByRole('tab', { name: '커뮤니티' })).findByText('99+')).toBeOnTheScreen();
});

test('읽지 않은 알림이 없거나 못 읽으면 배지를 달지 않는다', async () => {
  unreadCount.mockRejectedValue(new Error('down'));

  await render(<TabLayout />);
  await act(async () => undefined);

  expect(unreadCount).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(/^\d+\+?$/)).not.toBeOnTheScreen();
});

test('안드로이드는 아이콘 아래에 탭 이름을 두고, 고른 탭 이름만 blue-deep 이다', async () => {
  // 플랫폼은 모듈을 읽을 때 정해지므로, 안드로이드로 바꾼 별도 모듈 묶음에서 레이아웃과 렌더러를 함께 읽는다.
  // 설정 파일의 안전 영역 목은 바깥 묶음의 React 로 컨텍스트를 읽어서, 이 시험 동안 고정 여백을 돌려주게 한다.
  const safeArea = jest.requireMock('react-native-safe-area-context') as { useSafeAreaInsets: jest.Mock };
  const insetsFromContext = safeArea.useSafeAreaInsets.getMockImplementation();
  safeArea.useSafeAreaInsets.mockImplementation(() => ({ top: 0, bottom: 24, left: 0, right: 0 }));
  try {
    await jest.isolateModulesAsync(async () => {
      require('react-native').Platform.OS = 'android';
      const AndroidLayout: typeof TabLayout = require('@/app/(tabs)/_layout').default;
      const rtl: typeof import('@testing-library/react-native/pure') = require('@testing-library/react-native/pure');

      const view = await rtl.render(<AndroidLayout />);

      // 화면 매처는 바깥 묶음의 screen 을 보므로 이 묶음의 질의 결과를 직접 본다.
      const { StyleSheet } = require('react-native');
      const colorOf = (name: string) => StyleSheet.flatten(view.getByText(name).props.style).color;
      for (const name of TAB_NAMES) expect(view.getByText(name)).toBeTruthy();

      await rtl.fireEvent.press(view.getByRole('tab', { name: '코칭' }));

      expect([colorOf('코칭'), colorOf('리딩')]).toEqual(['#3268D8', '#6B7684']);
      expect(view.getAllByRole('tab').map((tab) => tab.props.accessibilityLabel)).toEqual(TAB_NAMES);
      await view.unmount();
    });
  } finally {
    safeArea.useSafeAreaInsets.mockImplementation(insetsFromContext);
  }
});
