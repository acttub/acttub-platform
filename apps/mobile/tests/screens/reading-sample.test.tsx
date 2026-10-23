import { fireEvent, render, screen } from '@testing-library/react-native';

import SampleScriptPicker from '@/app/reading/sample';

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn() };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  Stack: { Screen: () => null },
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

beforeEach(() => jest.clearAllMocks());

test('예시 대본을 목록 칩으로 바꿔 보고, 이 대본으로 하기는 그 대본으로 대본 넣기를 연다', async () => {
  await render(<SampleScriptPicker />);
  expect(screen.getByText('이 대본으로 해 볼까요?')).toBeOnTheScreen();
  expect(screen.getAllByText('옥상, 밤').length).toBeGreaterThan(0);
  await fireEvent.press(screen.getByRole('radio', { name: '카페, 헤어지자는 말' }));
  expect(screen.getAllByText('서연')[0]).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: '이 대본으로 하기' }));
  expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/reading/new', params: { sample: 'cafe' } });
});
