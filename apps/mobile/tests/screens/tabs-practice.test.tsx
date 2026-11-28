import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import CoachingRedirect from '@/app/(tabs)/coaching';
import PracticeTab from '@/app/(tabs)/practice';
import ReadingRedirect from '@/app/(tabs)/reading';
import { logEvent } from '@/lib/analytics';
import { PRACTICE_MODE_KEY, resetPracticeModeForTest } from '@/lib/practice-mode';

let mockParams: { mode?: string } = {};
const mockRouter = {
  setParams: jest.fn((next: { mode?: string }) => {
    mockParams = { ...mockParams, ...next };
  }),
};
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
  Redirect: ({ href }: { href: string }) => {
    const { Text } = require('react-native');
    return <Text>{`넘김 ${href}`}</Text>;
  },
}));
jest.mock('@/lib/analytics', () => ({ logEvent: jest.fn() }));
// 기기 저장소는 앱처럼 default 로 읽는다(lib/device-storage). 공용 목은 default 가 없어 감싼다.
jest.mock('@react-native-async-storage/async-storage', () => {
  const mock = require('@react-native-async-storage/async-storage/jest/async-storage-mock');
  return { __esModule: true, default: mock };
});
// 리딩·코칭 쪽 화면은 따로 시험한다(tabs-reading·tabs-coaching). 여기서는 어느 쪽을 그리는지와 머리에 전환을 넘기는지만 본다.
jest.mock('@/components/practice/reading-pane', () => ({
  __esModule: true,
  default: ({ modeSwitch }: { modeSwitch?: ReactNode }) => {
    const { Text, View } = require('react-native');
    return (
      <View>
        {modeSwitch}
        <Text>리딩 화면</Text>
      </View>
    );
  },
}));
jest.mock('@/components/practice/coaching-pane', () => ({
  __esModule: true,
  default: ({ modeSwitch }: { modeSwitch?: ReactNode }) => {
    const { Text, View } = require('react-native');
    return (
      <View>
        {modeSwitch}
        <Text>코칭 화면</Text>
      </View>
    );
  },
}));

beforeEach(async () => {
  jest.clearAllMocks();
  mockParams = {};
  resetPracticeModeForTest();
  await AsyncStorage.clear();
});

test('처음 열면 리딩이고, 맨 위에 「리딩 | 코칭」 전환이 있다', async () => {
  await render(<PracticeTab />);

  expect(await screen.findByText('리딩 화면')).toBeOnTheScreen();
  expect(screen.getByRole('tab', { name: '리딩', selected: true })).toBeOnTheScreen();
  expect(screen.getByRole('tab', { name: '코칭', selected: false })).toBeOnTheScreen();
  expect(screen.queryByText('코칭 화면')).not.toBeOnTheScreen();
});

test('코칭을 누르면 코칭 화면으로 바뀌고 practice_mode_select 를 남기며, 고른 쪽을 기기와 주소에 남긴다', async () => {
  await render(<PracticeTab />);
  await screen.findByText('리딩 화면');

  await fireEvent.press(screen.getByRole('tab', { name: '코칭' }));

  expect(screen.getByText('코칭 화면')).toBeOnTheScreen();
  expect(screen.queryByText('리딩 화면')).not.toBeOnTheScreen();
  expect(screen.getByRole('tab', { name: '코칭', selected: true })).toBeOnTheScreen();
  expect(logEvent).toHaveBeenCalledWith('practice_mode_select', { mode: 'coaching' });
  expect(mockRouter.setParams).toHaveBeenCalledWith({ mode: 'coaching' });
  expect(await AsyncStorage.getItem(PRACTICE_MODE_KEY)).toBe('coaching');

  // 이미 고른 쪽을 다시 눌러도 남기지 않는다.
  await fireEvent.press(screen.getByRole('tab', { name: '코칭' }));
  expect(logEvent).toHaveBeenCalledTimes(1);
});

test('앱을 다시 열면 기기에 남긴 마지막 쪽을 연다', async () => {
  await AsyncStorage.setItem(PRACTICE_MODE_KEY, 'coaching');
  await render(<PracticeTab />);

  expect(await screen.findByText('코칭 화면')).toBeOnTheScreen();
  expect(screen.getByRole('tab', { name: '코칭', selected: true })).toBeOnTheScreen();
});

test('주소가 mode 를 정하면(다른 화면·알림·딥링크) 기억과 상관없이 그쪽을 열고 그쪽을 기억한다', async () => {
  await AsyncStorage.setItem(PRACTICE_MODE_KEY, 'reading');
  mockParams = { mode: 'coaching' };
  const view = await render(<PracticeTab />);

  expect(screen.getByText('코칭 화면')).toBeOnTheScreen();
  await act(async () => undefined);
  expect(await AsyncStorage.getItem(PRACTICE_MODE_KEY)).toBe('coaching');

  // 이미 연 탭에 다른 쪽 주소로 다시 오면 그쪽으로 바뀐다.
  mockParams = { mode: 'reading' };
  await view.rerender(<PracticeTab />);
  expect(screen.getByText('리딩 화면')).toBeOnTheScreen();
  expect(logEvent).not.toHaveBeenCalled();
});

test('예전 리딩·코칭 탭 주소(서버 공지 버튼·옛 딥링크)는 연습 탭의 그쪽으로 넘긴다', async () => {
  await render(<ReadingRedirect />);
  expect(screen.getByText('넘김 /practice?mode=reading')).toBeOnTheScreen();
  await render(<CoachingRedirect />);
  expect(screen.getByText('넘김 /practice?mode=coaching')).toBeOnTheScreen();
});

test('주소의 mode 가 리딩·코칭이 아니면 무시하고 기억한 쪽을 연다', async () => {
  await AsyncStorage.setItem(PRACTICE_MODE_KEY, 'coaching');
  mockParams = { mode: 'home' };
  await render(<PracticeTab />);

  expect(await screen.findByText('코칭 화면')).toBeOnTheScreen();
});
