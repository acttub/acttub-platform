import { act, render } from '@testing-library/react-native';

import InviteOpenScreen from '@/app/invite';

const mockRouter = { dismissTo: jest.fn() };
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
}));
const mockStorage = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => mockStorage.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => void mockStorage.set(key, value)),
    removeItem: jest.fn(async (key: string) => void mockStorage.delete(key)),
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockStorage.clear();
});

test('초대 딥링크의 코드를 기기에 맡기고 프로필 탭으로 바꿔 연다', async () => {
  mockParams = { code: 'abc234' };
  await render(<InviteOpenScreen />);
  await act(async () => {});

  expect(mockStorage.get('acttub.invite.pendingCode')).toBe('ABC234');
  expect(mockRouter.dismissTo).toHaveBeenCalledWith('/profile');
});

test('코드 모양이 아니면 맡기지 않고 프로필 탭으로만 간다', async () => {
  mockParams = { code: 'nope' };
  await render(<InviteOpenScreen />);
  await act(async () => {});

  expect(mockStorage.size).toBe(0);
  expect(mockRouter.dismissTo).toHaveBeenCalledWith('/profile');
});
