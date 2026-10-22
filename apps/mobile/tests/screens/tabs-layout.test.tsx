import { act, fireEvent, render, screen } from '@testing-library/react-native';

import TabLayout from '@/app/(tabs)/_layout';
import { api } from '@/lib/api';
import { setFirstTimeState } from '@/lib/practice/first-time';

const mockRouter = { push: jest.fn() };

// 탭 내비게이터 대신, 받은 화면 설정대로 탭을 그리고 누르면 그 탭이 활성이 되는 최소 탭바.
// React·react-native 는 그릴 때 읽는다 — 안드로이드 시험이 따로 읽은 모듈 묶음에서도 같은 React 를 쓰게 한다.
jest.mock('expo-router', () => {
  function Tabs({ screenOptions, children }: { screenOptions: Record<string, any>; children: unknown }) {
    const { Children, useState } = require('react');
    const { Text, View } = require('react-native');
    const screens = (Children.toArray(children) as { props: { name: string; options: Record<string, any> } }[])
      .map((child) => child.props)
      .filter((props) => props.options.href !== null);
    const [focused, setFocused] = useState(screens[0].name);
    const current = screens.find((s) => s.name === focused)!;
    // 지금 탭의 화면 설정이 탭바 모양을 정한다(첫 사용자는 모든 탭에서 숨긴다).
    const barStyle = current.options.tabBarStyle ?? screenOptions.tabBarStyle;
    return (
      <View>
        <Text>{`탭바 ${barStyle?.display === 'none' ? '숨김' : '보임'}`}</Text>
        {screens.map(({ name, options }) => {
          const on = focused === name;
          const Icon = options.tabBarIcon;
          const Button = options.tabBarButton;
          return (
            <Button
              key={name}
              accessibilityRole="tab"
              accessibilityLabel={options.tabBarAccessibilityLabel}
              accessibilityState={{ selected: on }}
              onPress={() => setFocused(name)}>
              <Icon focused={on} color={on ? screenOptions.tabBarActiveTintColor : screenOptions.tabBarInactiveTintColor} />
              {options.tabBarBadge !== undefined && <Text>{`${options.title} 배지 ${options.tabBarBadge}`}</Text>}
            </Button>
          );
        })}
      </View>
    );
  }
  Tabs.Screen = () => null;
  return { Tabs, useRouter: () => mockRouter };
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
jest.mock('@/lib/api', () => ({ api: { unreadNotificationCount: jest.fn() } }));

const unreadCount = api.unreadNotificationCount as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  unreadCount.mockResolvedValue({ count: 0 });
});

test('홈·코칭·리딩·챌린지·프로필 탭을 두고 기록·예전 촬영 자리는 탭바에서 뺀다', async () => {
  await render(<TabLayout />);

  expect(screen.getAllByRole('tab').map((tab) => tab.props.accessibilityLabel)).toEqual(['홈', '코칭', '리딩', '챌린지', '프로필']);
});

test('아이콘만 있는 탭마다 읽어 줄 이름과 누름 기록 이름을 단다', async () => {
  await render(<TabLayout />);

  expect(screen.getAllByRole('tab').map((tab) => tab.props['ph-label'])).toEqual([
    'tab_home',
    'tab_coaching',
    'tab_reading',
    'tab_challenge',
    'tab_profile',
  ]);
});

test('활성·비활성 모두 윤곽 아이콘이고 이름은 고른 탭에만 쓴다(10/23 pen 하단바 규칙)', async () => {
  await render(<TabLayout />);

  expect(screen.getByText('아이콘 home-outline')).toBeOnTheScreen();
  expect(screen.getByText('아이콘 book-outline')).toBeOnTheScreen();
  expect(screen.getByText('홈')).toBeOnTheScreen();
  for (const name of ['코칭', '리딩', '챌린지', '프로필']) expect(screen.queryByText(name)).not.toBeOnTheScreen();

  await fireEvent.press(screen.getByRole('tab', { name: '리딩' }));
  expect(screen.getByText('리딩')).toBeOnTheScreen();
  expect(screen.queryByText('홈')).not.toBeOnTheScreen();

  expect(screen.getByRole('tab', { name: '리딩', selected: true })).toBeOnTheScreen();
  expect(screen.getByRole('tab', { name: '홈', selected: false })).toBeOnTheScreen();
  expect(screen.getByText('아이콘 book-outline')).toBeOnTheScreen();
});

test('첫 사용자로 확인되면 모든 탭에서 탭바를 숨기고, 첫 연습을 하면 다시 보인다', async () => {
  await render(<TabLayout />);
  expect(screen.getByText('탭바 보임')).toBeOnTheScreen();

  await act(async () => setFirstTimeState('first'));
  expect(screen.getByText('탭바 숨김')).toBeOnTheScreen();
  for (const name of ['코칭', '리딩', '챌린지', '프로필', '홈']) {
    await fireEvent.press(screen.getByRole('tab', { name }));
    expect(screen.getByText('탭바 숨김')).toBeOnTheScreen();
  }

  await act(async () => setFirstTimeState('practiced'));
  expect(screen.getByText('탭바 보임')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('tab', { name: '리딩' }));
  expect(screen.getByText('탭바 보임')).toBeOnTheScreen();

  await act(async () => setFirstTimeState('unknown'));
});

test('첫 사용자인지 아직 모르면(홈을 거치지 않고 다른 탭으로 바로 들어온 경우) 탭바를 보인다', async () => {
  await render(<TabLayout />);
  await fireEvent.press(screen.getByRole('tab', { name: '챌린지' }));

  expect(screen.getByText('탭바 보임')).toBeOnTheScreen();
});

test('읽지 않은 알림 묶음이 있으면 챌린지 탭에 그 수를 단다', async () => {
  unreadCount.mockResolvedValue({ count: 120 });

  await render(<TabLayout />);

  expect(await screen.findByText('챌린지 배지 99+')).toBeOnTheScreen();
});

test('읽지 않은 알림이 없거나 못 읽으면 배지를 달지 않는다', async () => {
  unreadCount.mockRejectedValue(new Error('down'));

  await render(<TabLayout />);
  await act(async () => undefined);

  expect(unreadCount).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(/배지/)).not.toBeOnTheScreen();
  expect(screen.getByRole('tab', { name: '챌린지' })).toBeOnTheScreen();
});

test('안드로이드도 고른 탭에만 이름을 아이콘 아래에 쓴다(10/23 pen 하단바 규칙)', async () => {
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
      expect(view.queryByText('홈')).not.toBeNull();
      expect(view.queryByText('리딩')).toBeNull();

      await rtl.fireEvent.press(view.getByRole('tab', { name: '리딩' }));

      expect(view.queryByText('리딩')).not.toBeNull();
      expect(view.queryByText('홈')).toBeNull();
      await view.unmount();
    });
  } finally {
    safeArea.useSafeAreaInsets.mockImplementation(insetsFromContext);
  }
});
