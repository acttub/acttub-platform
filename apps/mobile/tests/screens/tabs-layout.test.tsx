import { act, fireEvent, render, screen } from '@testing-library/react-native';

import TabLayout from '@/app/(tabs)/_layout';
import { api } from '@/lib/api';

const mockRouter = { push: jest.fn() };

// 탭 내비게이터 대신, 받은 화면 설정대로 탭을 그리고 누르면 그 탭이 활성이 되는 최소 탭바.
// React·react-native 는 그릴 때 읽는다 — 안드로이드 시험이 따로 읽은 모듈 묶음에서도 같은 React 를 쓰게 한다.
jest.mock('expo-router', () => {
  function Tabs({ screenOptions, children }: { screenOptions: Record<string, any>; children: unknown }) {
    const { Children, Fragment, useState } = require('react');
    const { Pressable, Text, View } = require('react-native');
    const screens = (Children.toArray(children) as { props: { name: string; options: Record<string, any> } }[])
      .map((child) => child.props)
      .filter((props) => props.options.href !== null);
    const [focused, setFocused] = useState(screens[0].name);
    return (
      <View>
        {screens.map(({ name, options }) => {
          if (options.tabBarButton) return <Fragment key={name}>{options.tabBarButton({})}</Fragment>;
          const on = focused === name;
          const Icon = options.tabBarIcon;
          return (
            <Pressable
              key={name}
              accessibilityRole="tab"
              accessibilityLabel={options.title}
              accessibilityState={{ selected: on }}
              onPress={() => setFocused(name)}>
              <Icon focused={on} color={on ? screenOptions.tabBarActiveTintColor : screenOptions.tabBarInactiveTintColor} />
              {options.tabBarBadge !== undefined && <Text>{`${options.title} 배지 ${options.tabBarBadge}`}</Text>}
            </Pressable>
          );
        })}
      </View>
    );
  }
  Tabs.Screen = () => null;
  return { Tabs, useRouter: () => mockRouter };
});
jest.mock('@expo/vector-icons/Ionicons', () => ({ name }: { name: string }) => {
  const { Text } = require('react-native');
  return <Text>{`아이콘 ${name}`}</Text>;
});
jest.mock('@/components/legacy-archive-prompt', () => ({ LegacyArchivePrompt: () => null }));
jest.mock('@/lib/api', () => ({ api: { unreadNotificationCount: jest.fn() } }));

const unreadCount = api.unreadNotificationCount as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  unreadCount.mockResolvedValue({ count: 0 });
});

test('홈·대본·챌린지·프로필 탭을 두고 기록은 탭바에서 뺀다', async () => {
  await render(<TabLayout />);

  expect(screen.getAllByRole('tab').map((tab) => tab.props.accessibilityLabel)).toEqual(['홈', '대본', '챌린지', '프로필']);
});

test('활성 탭은 채운 아이콘, 나머지는 윤곽 아이콘이고 iOS 에서는 글자를 붙이지 않는다', async () => {
  await render(<TabLayout />);

  expect(screen.getByText('아이콘 home')).toBeOnTheScreen();
  expect(screen.getByText('아이콘 book-outline')).toBeOnTheScreen();
  expect(screen.queryByText('홈')).not.toBeOnTheScreen();

  await fireEvent.press(screen.getByRole('tab', { name: '대본' }));

  expect(screen.getByText('아이콘 home-outline')).toBeOnTheScreen();
  expect(screen.getByText('아이콘 book')).toBeOnTheScreen();
  expect(screen.getByRole('tab', { name: '대본', selected: true })).toBeOnTheScreen();
});

test('가운데 촬영 버튼은 용도를 고르는 카메라를 바로 연다', async () => {
  await render(<TabLayout />);

  await fireEvent.press(screen.getByRole('button', { name: '촬영 시작' }));

  expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/record-video', params: { mode: 'ai', picker: '1' } });
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

test('안드로이드에서는 활성 탭 아이콘 아래에 탭 이름을 쓴다', async () => {
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
      expect(view.queryByText('대본')).toBeNull();

      await rtl.fireEvent.press(view.getByRole('tab', { name: '대본' }));

      expect(view.queryByText('대본')).not.toBeNull();
      expect(view.queryByText('홈')).toBeNull();
      await view.unmount();
    });
  } finally {
    safeArea.useSafeAreaInsets.mockImplementation(insetsFromContext);
  }
});
