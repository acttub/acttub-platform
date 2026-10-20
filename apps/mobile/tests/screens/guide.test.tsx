import { fireEvent, render, screen } from '@testing-library/react-native';
import { Dimensions } from 'react-native';

import GuideScreen from '@/app/guide';
import { logEvent } from '@/lib/analytics';

const mockRouter = { back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn() };
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, useRouter: () => mockRouter }));
jest.mock('@/lib/analytics', () => ({ logEvent: jest.fn() }));

beforeEach(() => jest.clearAllMocks());

test('건너뛰면 첫 장 위치를 남기고 이전 화면으로 돌아간다', async () => {
  mockRouter.canGoBack.mockReturnValue(true);
  await render(<GuideScreen />);

  expect(screen.getByText('오늘의 연기를 찍어요')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: '건너뛰기' }));

  expect(logEvent).toHaveBeenCalledWith('guide_finish', { how: 'skip', at: 0 });
  expect(mockRouter.back).toHaveBeenCalledTimes(1);
  expect(mockRouter.replace).not.toHaveBeenCalled();
});

test('다음을 누르면 마지막 장 전에는 끝내지 않는다', async () => {
  await render(<GuideScreen />);
  await fireEvent.press(screen.getByRole('button', { name: /다음/ }));

  expect(logEvent).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: /다음/ })).toBeOnTheScreen();
});

test('마지막 장까지 넘기면 시작하기가 되고, 돌아갈 곳이 없으면 홈으로 간다', async () => {
  mockRouter.canGoBack.mockReturnValue(false);
  await render(<GuideScreen />);
  const { width } = Dimensions.get('window');

  await fireEvent(screen.getByText('대본 리딩과 대사 챌린지도'), 'momentumScrollEnd', {
    nativeEvent: { contentOffset: { x: width * 3, y: 0 } },
  });
  await fireEvent.press(screen.getByRole('button', { name: '시작하기' }));

  expect(logEvent).toHaveBeenCalledWith('guide_finish', { how: 'done', at: 3 });
  expect(mockRouter.replace).toHaveBeenCalledWith('/');
  expect(mockRouter.back).not.toHaveBeenCalled();
});
