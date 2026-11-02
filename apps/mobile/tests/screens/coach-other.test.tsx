import { fireEvent, render, screen } from '@testing-library/react-native';

import CoachOtherScreen from '@/app/coach-other';

const mockRouter = { push: jest.fn() };

jest.mock('expo-router', () => {
  const { useEffect } = require('react');
  return {
    Stack: { Screen: () => null },
    useRouter: () => mockRouter,
    useFocusEffect: (effect: () => void | (() => void)) => useEffect(effect, [effect]),
  };
});
jest.mock('expo-image', () => ({ Image: () => null }));
const mockListScripts = jest.fn();
jest.mock('@/lib/reading/store', () => ({ listScripts: () => mockListScripts() }));

beforeEach(() => {
  jest.clearAllMocks();
  mockListScripts.mockResolvedValue({ scripts: [], total_count: 0, in_progress_count: 0 });
});

test('첫 항목(말로 코칭)을 골라 둔 채 「다음」을 누르면 말로 코칭 목적 화면으로 간다', async () => {
  await render(<CoachOtherScreen />);
  expect(await screen.findByText('어떻게 코칭 받을래요?')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: '다음' }));
  expect(mockRouter.push).toHaveBeenLastCalledWith('/talk');
});

test('저장한 대본이 없으면 「내 대본으로 찍기」는 없고, 대사 같이 만들기를 고르면 그 화면으로 간다', async () => {
  await render(<CoachOtherScreen />);
  expect(await screen.findByText('찍을 대사부터 같이 만들기')).toBeOnTheScreen();
  expect(screen.queryByText('내 대본으로 찍기')).not.toBeOnTheScreen();
  await fireEvent.press(screen.getByText('찍을 대사부터 같이 만들기'));
  await fireEvent.press(screen.getByRole('button', { name: '다음' }));
  expect(mockRouter.push).toHaveBeenLastCalledWith('/script-cocreate');
});

test('저장한 대본이 있으면 「내 대본으로 찍기」가 생기고 대본 고르기 화면으로 간다', async () => {
  mockListScripts.mockResolvedValue({ scripts: [{ id: 's1' }], total_count: 1, in_progress_count: 0 });
  await render(<CoachOtherScreen />);
  await fireEvent.press(await screen.findByText('내 대본으로 찍기'));
  await fireEvent.press(screen.getByRole('button', { name: '다음' }));
  expect(mockRouter.push).toHaveBeenLastCalledWith('/coach-scripts');
});
