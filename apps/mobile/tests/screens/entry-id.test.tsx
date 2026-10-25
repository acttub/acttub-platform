import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import EntryLinkScreen from '@/app/entry/[id]';
import { api } from '@/lib/api';

const mockRouter = { dismissTo: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => false) };
let mockParams: { id?: string } = {};
jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@/lib/api', () => ({ api: { getEntry: jest.fn() } }));

const getEntry = api.getEntry as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = { id: 'e1' };
});

test('볼 수 있는 참여작이면 그 참여작부터 챌린지 피드를 연다', async () => {
  getEntry.mockResolvedValue({ id: 'e1', challenge_id: 'c9' });
  await render(<EntryLinkScreen />);

  await waitFor(() =>
    expect(mockRouter.replace).toHaveBeenCalledWith({
      pathname: '/challenge-play',
      params: { id: 'c9', entryId: 'e1' },
    }),
  );
  expect(getEntry).toHaveBeenCalledWith('e1');
});

test('없거나 막힌 참여작(404)이면 볼 수 없다고 안내하고 챌린지 목록으로 보낸다', async () => {
  getEntry.mockRejectedValue(Object.assign(new Error('nf'), { status: 404 }));
  await render(<EntryLinkScreen />);

  expect(await screen.findByText('볼 수 없는 영상이에요')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: '이번 주 챌린지 보러 가기' }));
  expect(mockRouter.dismissTo).toHaveBeenCalledWith('/challenges');
});

test('다른 오류면 챌린지를 불러오지 못했다고 안내한다', async () => {
  getEntry.mockRejectedValue(Object.assign(new Error('boom'), { status: 500 }));
  await render(<EntryLinkScreen />);
  expect(await screen.findByText('챌린지를 불러오지 못했어요.')).toBeOnTheScreen();
  // 탭 묶음을 하나 더 쌓지 않고 이미 있는 챌린지 탭까지 내려간다(SOMA-853).
  await fireEvent.press(screen.getByRole('button', { name: '이번 주 챌린지 보러 가기' }));
  expect(mockRouter.dismissTo).toHaveBeenCalledWith('/challenges');
  expect(mockRouter.replace).not.toHaveBeenCalled();
});

test('닫기: 돌아갈 화면이 있으면 뒤로, 링크로 바로 들어와 없으면 챌린지 탭으로 간다', async () => {
  getEntry.mockRejectedValue(Object.assign(new Error('nf'), { status: 404 }));
  await render(<EntryLinkScreen />);
  await screen.findByText('볼 수 없는 영상이에요');

  await fireEvent.press(screen.getByRole('button', { name: '닫기' }));
  expect(mockRouter.dismissTo).toHaveBeenCalledWith('/challenges');
  expect(mockRouter.back).not.toHaveBeenCalled();

  mockRouter.canGoBack.mockReturnValueOnce(true);
  await fireEvent.press(screen.getByRole('button', { name: '닫기' }));
  expect(mockRouter.back).toHaveBeenCalledTimes(1);
});

test('링크에 id가 없으면 서버에 묻지 않고 볼 수 없다고 안내한다', async () => {
  mockParams = {};
  await render(<EntryLinkScreen />);
  expect(screen.getByText('볼 수 없는 영상이에요')).toBeOnTheScreen();
  expect(getEntry).not.toHaveBeenCalled();
});

test('응답 전에 화면을 떠나면 이동하지 않는다', async () => {
  let resolve!: (v: unknown) => void;
  let reject!: (e: unknown) => void;
  getEntry.mockReturnValueOnce(new Promise((r) => (resolve = r)));
  const first = await render(<EntryLinkScreen />);
  await first.unmount();
  resolve({ id: 'e1', challenge_id: 'c9' });

  getEntry.mockReturnValueOnce(new Promise((_, j) => (reject = j)));
  const second = await render(<EntryLinkScreen />);
  await second.unmount();
  reject(Object.assign(new Error('nf'), { status: 404 }));

  await new Promise((r) => setTimeout(r, 0));
  expect(mockRouter.replace).not.toHaveBeenCalled();

  getEntry.mockResolvedValueOnce({ id: 'e1', challenge_id: 'c9' });
  await render(<EntryLinkScreen />);
  await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledTimes(1));
});
