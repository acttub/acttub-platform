import { fireEvent, render, screen } from '@testing-library/react-native';

import UiPreviewScreen from '@/app/ui-preview';
import { seedPractice } from '@/lib/ui-preview';

const mockRouter = { push: jest.fn() };
let mockParams: { go?: string } = {};
jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@/lib/ui-preview', () => ({ seedPractice: jest.fn() }));

const devFlag = (globalThis as { __DEV__: boolean }).__DEV__;

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
});

afterEach(() => {
  (globalThis as { __DEV__: boolean }).__DEV__ = devFlag;
});

test.each([
  ['분석 진행', undefined, '/coach?preview=1'],
  ['질문 대화', undefined, '/coach'],
  ['분석 결과', { withReport: true }, '/report?preview=1'],
])('%s 항목을 누르면 가짜 연습을 심고 그 화면으로 간다', async (label, seedArg, path) => {
  await render(<UiPreviewScreen />);
  await fireEvent.press(screen.getByText(label));

  expect((seedPractice as jest.Mock).mock.calls).toEqual([seedArg === undefined ? [] : [seedArg]]);
  expect(mockRouter.push).toHaveBeenCalledWith(path);
});

test('go 인자가 있으면 한 번만 곧장 그 화면으로 뛴다', async () => {
  mockParams = { go: 'report' };
  const view = await render(<UiPreviewScreen />);
  await view.rerender(<UiPreviewScreen />);

  expect(seedPractice).toHaveBeenCalledWith({ withReport: true });
  expect(mockRouter.push.mock.calls).toEqual([['/report?preview=1']]);
});

test('모르는 go 인자는 무시하고 목록만 보여 준다', async () => {
  mockParams = { go: 'nowhere' };
  await render(<UiPreviewScreen />);

  expect(screen.getByText('질문 대화')).toBeOnTheScreen();
  expect(mockRouter.push).not.toHaveBeenCalled();
});

test('배포 빌드에서는 열리지 않는다', async () => {
  (globalThis as { __DEV__: boolean }).__DEV__ = false;
  await render(<UiPreviewScreen />);

  expect(screen.getByText('개발 빌드에서만 열려요.')).toBeOnTheScreen();
  expect(screen.queryByText('분석 진행')).not.toBeOnTheScreen();
});
