import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { useAppRating } from '@/hooks/use-app-rating';
import { logEvent } from '@/lib/analytics';
import { openStoreReview } from '@/lib/store-review';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
}));
jest.mock('@/lib/analytics', () => ({ logEvent: jest.fn() }));
jest.mock('@/lib/store-review', () => ({ openStoreReview: jest.fn(async () => undefined) }));

const KEY = 'acttub.appRating';
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 20);

let rating: ReturnType<typeof useAppRating>;
function Host() {
  rating = useAppRating();
  return <>{rating.element}<Text>host</Text></>;
}
const stored = async () => JSON.parse((await AsyncStorage.getItem(KEY)) ?? 'null');
const ask = async (proceed: () => void) => {
  await act(() => rating.after({ kind: 'coach', practiceId: 'p2' }, proceed));
};

beforeEach(async () => {
  jest.clearAllMocks();
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  await AsyncStorage.clear();
  await AsyncStorage.setItem(KEY, JSON.stringify({ rated: false, asks: 0, lastAskAt: null, coachSinceAsk: 1, readingSinceAsk: 0, counted: ['p1'] }));
  await render(<Host />);
});

test('물을 때가 아니면 센 것만 저장하고 곧바로 다음으로 간다', async () => {
  await AsyncStorage.clear();
  const proceed = jest.fn();

  await act(() => rating.after({ kind: 'reading' }, proceed));

  expect(proceed).toHaveBeenCalledTimes(1);
  expect(await stored()).toEqual({ rated: false, asks: 0, lastAskAt: null, coachSinceAsk: 0, readingSinceAsk: 1, counted: [] });
  expect(screen.queryByText('Acttub 어떠셨어요?')).not.toBeOnTheScreen();
});

test('AI 코칭 두 번째면 카드를 보이고 물은 기록을 남긴다', async () => {
  const proceed = jest.fn();
  await ask(proceed);

  expect(screen.getByText('Acttub 어떠셨어요?')).toBeOnTheScreen();
  expect(proceed).not.toHaveBeenCalled();
  expect(logEvent).toHaveBeenCalledWith('app_rating_prompt', { trigger: 'coach' });
  expect(await stored()).toEqual({ rated: false, asks: 1, lastAskAt: NOW, coachSinceAsk: 0, readingSinceAsk: 0, counted: ['p1', 'p2'] });

  await fireEvent.press(screen.getByText('Acttub 어떠셨어요?'));
  expect(screen.getByText('Acttub 어떠셨어요?')).toBeOnTheScreen();
  expect(proceed).not.toHaveBeenCalled();
});

test('별점 남기기를 누르면 평가한 것으로 남기고 스토어 평가를 연 뒤 다음으로 간다', async () => {
  const proceed = jest.fn();
  await ask(proceed);

  await fireEvent.press(screen.getByText('별점 남기기'));
  await act(async () => { await Promise.resolve(); });

  expect(openStoreReview).toHaveBeenCalledTimes(1);
  expect(logEvent).toHaveBeenCalledWith('app_rating_accept', {});
  expect((await stored()).rated).toBe(true);
  expect(proceed).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('Acttub 어떠셨어요?')).not.toBeOnTheScreen();
});

test('나중에를 누르면 닫고 다음으로 가며, 7일 안에는 다시 묻지 않는다', async () => {
  const proceed = jest.fn();
  await ask(proceed);

  await fireEvent.press(screen.getByText('나중에'));
  expect(logEvent).toHaveBeenCalledWith('app_rating_later', {});
  expect(proceed).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('Acttub 어떠셨어요?')).not.toBeOnTheScreen();

  (Date.now as jest.Mock).mockReturnValue(NOW + 6 * DAY);
  const again = jest.fn();
  await act(() => rating.after({ kind: 'coach', practiceId: 'p3' }, again));
  await act(() => rating.after({ kind: 'coach', practiceId: 'p4' }, again));
  expect(again).toHaveBeenCalledTimes(2);
  expect(screen.queryByText('Acttub 어떠셨어요?')).not.toBeOnTheScreen();
});

test('다음 할 일 없이 물어도 닫힐 때 문제없다', async () => {
  await act(() => rating.after({ kind: 'coach', practiceId: 'p2' }));
  await fireEvent.press(screen.getByText('나중에'));
  expect(screen.queryByText('Acttub 어떠셨어요?')).not.toBeOnTheScreen();
});

test('저장소를 읽거나 쓰지 못해도 처음 상태로 묻고 흐름은 그대로 간다', async () => {
  jest.spyOn(AsyncStorage, 'getItem').mockRejectedValue(new Error('io'));
  jest.spyOn(AsyncStorage, 'setItem').mockRejectedValue(new Error('io'));
  const proceed = jest.fn();

  await act(() => rating.after({ kind: 'reading' }, proceed));

  expect(proceed).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('Acttub 어떠셨어요?')).not.toBeOnTheScreen();
});
