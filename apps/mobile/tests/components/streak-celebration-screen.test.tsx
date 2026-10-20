import * as Haptics from 'expo-haptics';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { StreakCelebrationScreen } from '@/components/streak-celebration-screen';
import type { CelebrationDot } from '@/lib/streak-celebration';

jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(async () => undefined),
  NotificationFeedbackType: { Success: 'success' },
}));

const notify = Haptics.notificationAsync as jest.Mock;

const dots: CelebrationDot[] = [
  { key: 'mon', label: '월', state: 'done' },
  { key: 'tue', label: '화', state: 'today' },
  { key: 'wed', label: '수', state: 'empty' },
];

beforeEach(() => {
  jest.useFakeTimers();
  notify.mockClear();
});

afterEach(() => {
  jest.useRealTimers();
});

test('어제 연속일을 먼저 보이고, 잠시 뒤 오늘 연속일로 바꾸며 성공 햅틱을 울린다', async () => {
  await render(<StreakCelebrationScreen streak={5} dots={dots} onDone={jest.fn()} />);

  expect(screen.getByLabelText('5일 연속 연습 축하')).toBeOnTheScreen();
  expect(screen.getByText('4')).toBeOnTheScreen();
  expect(screen.queryByText('5')).toBeNull();
  expect(notify.mock.calls).toEqual([]);

  await act(async () => {
    jest.advanceTimersByTime(650);
  });

  expect(screen.getByText('5')).toBeOnTheScreen();
  expect(screen.queryByText('4')).toBeNull();
  expect(notify.mock.calls).toEqual([['success']]);
  expect(screen.getByText('일 연속 연습!')).toBeOnTheScreen();
  expect(screen.getByText('내일도 찍으면 6일이에요')).toBeOnTheScreen();
});

test('이번 주 요일을 모두 보이고, 연습한 날과 오늘에만 체크를 단다', async () => {
  await render(<StreakCelebrationScreen streak={5} dots={dots} onDone={jest.fn()} />);

  expect(screen.getByText('월')).toBeOnTheScreen();
  expect(screen.getByText('화')).toBeOnTheScreen();
  expect(screen.getByText('수')).toBeOnTheScreen();
  expect(screen.getAllByText('✓')).toHaveLength(2);
});

test('첫 연속일이면 0에서 1로 바뀌고 첫 불꽃 문구를 함께 보인다', async () => {
  await render(<StreakCelebrationScreen streak={1} dots={[]} onDone={jest.fn()} />);

  expect(screen.getByText('0')).toBeOnTheScreen();
  expect(screen.getByText('첫 불꽃이 켜졌어요\n내일도 찍으면 2일이에요')).toBeOnTheScreen();

  await act(async () => {
    jest.advanceTimersByTime(650);
  });

  expect(screen.getByText('1')).toBeOnTheScreen();
});

test('햅틱을 못 울리는 기기에서도 숫자는 오늘 값으로 바뀐다', async () => {
  notify.mockImplementationOnce(() => {
    throw new Error('haptics unavailable');
  });
  await render(<StreakCelebrationScreen streak={3} dots={dots} onDone={jest.fn()} />);

  await act(async () => {
    jest.advanceTimersByTime(650);
  });

  expect(screen.getByText('3')).toBeOnTheScreen();
  expect(screen.queryByText('2')).toBeNull();
});

test('계속하기를 누르거나 뒤로 가기를 하면 축하를 닫는다', async () => {
  const onDone = jest.fn();
  await render(<StreakCelebrationScreen streak={2} dots={dots} onDone={onDone} />);

  await fireEvent.press(screen.getByRole('button', { name: '계속하기' }));
  expect(onDone).toHaveBeenCalledTimes(1);

  await fireEvent(screen.getByText('계속하기'), 'requestClose');
  expect(onDone).toHaveBeenCalledTimes(2);
});
