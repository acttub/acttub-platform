import { fireEvent, render, screen } from '@testing-library/react-native';

import SavedVideosScreen from '@/app/saved-videos';
import { logEvent } from '@/lib/analytics';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/api-request';
import { entryCard } from '../helpers/challenge-card';

const mockRouter = { back: jest.fn(), push: jest.fn() };
let mockParams: { tab?: string } = {};
jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@/lib/api', () => ({
  api: { listSavedEntries: jest.fn(), listMyChallengeEntries: jest.fn(), saveEntry: jest.fn() },
}));
jest.mock('@/lib/analytics', () => ({ logEvent: jest.fn() }));

const listSaved = api.listSavedEntries as jest.Mock;
const listMine = api.listMyChallengeEntries as jest.Mock;
const saveEntry = api.saveEntry as jest.Mock;

const savedA = entryCard({ id: 's1', author: { name: '태오', user_id: 'u2' }, caption: '눈빛 참고', like_count: 12 });
const savedB = entryCard({ id: 's2', author: { name: '민재', user_id: 'u3' }, caption: null, like_count: 3 });
const mineA = entryCard({ id: 'm1', author: { name: '나', user_id: 'me' }, caption: '첫 도전', is_mine: true });

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  listSaved.mockResolvedValue({ entries: [savedA, savedB] });
  listMine.mockResolvedValue({ entries: [mineA] });
});

test('기본은 저장한 영상 탭이고 두 탭의 개수를 보여 준다', async () => {
  await render(<SavedVideosScreen />);

  expect(await screen.findByText('눈빛 참고')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: '저장한 영상 2' })).toBeSelected();
  expect(screen.getByRole('button', { name: '내 영상 1' })).not.toBeSelected();
  expect(screen.getByText('다른 사람 연기에서 참고할 부분을 모아 뒀어요.')).toBeOnTheScreen();
  expect(screen.getByText('12 · 태오')).toBeOnTheScreen();
  expect(screen.queryByText('첫 도전')).not.toBeOnTheScreen();
});

test('내 영상 탭으로 열면 내 참여작만 보이고 저장 풀기 버튼이 없다', async () => {
  mockParams = { tab: 'mine' };
  await render(<SavedVideosScreen />);

  expect(await screen.findByText('첫 도전')).toBeOnTheScreen();
  expect(screen.getByText('챌린지에 올린 내 연기 영상이에요.')).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: '저장' })).not.toBeOnTheScreen();

  await fireEvent.press(screen.getByRole('button', { name: '저장한 영상 2' }));
  expect(screen.getAllByRole('button', { name: '저장' })).toHaveLength(2);
});

test('영상을 누르면 어느 탭에서 열었는지 남기고 재생 화면으로 간다', async () => {
  await render(<SavedVideosScreen />);
  await fireEvent.press(await screen.findByText('눈빛 참고'));

  expect(logEvent).toHaveBeenCalledWith('saved_video_open', { id: 's1', tab: 'saved' });
  expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/challenge-play', params: { entryId: 's1' } });
});

test('저장을 풀면 바로 목록에서 빠지고 서버에 풀기를 보낸다', async () => {
  saveEntry.mockResolvedValue(undefined);
  await render(<SavedVideosScreen />);
  await screen.findByText('눈빛 참고');

  await fireEvent.press(screen.getAllByRole('button', { name: '저장' })[0]);

  expect(saveEntry).toHaveBeenCalledWith('s1', false);
  expect(screen.queryByText('눈빛 참고')).not.toBeOnTheScreen();
  expect(screen.getByRole('button', { name: '저장한 영상 1' })).toBeOnTheScreen();
});

test('저장 풀기가 실패하면 목록을 다시 불러와 빠진 영상을 되돌린다', async () => {
  saveEntry.mockRejectedValue(Object.assign(new Error('offline'), { status: 500 }));
  await render(<SavedVideosScreen />);
  await screen.findByText('눈빛 참고');

  await fireEvent.press(screen.getAllByRole('button', { name: '저장' })[0]);

  expect(await screen.findByText('눈빛 참고')).toBeOnTheScreen();
  expect(listSaved).toHaveBeenCalledTimes(2);
});

test('저장 풀기가 실패하면 실패 이유를 보여 준다', async () => {
  saveEntry.mockRejectedValue(Object.assign(new Error('gone'), { status: 404 }));
  await render(<SavedVideosScreen />);
  await screen.findByText('눈빛 참고');

  await fireEvent.press(screen.getAllByRole('button', { name: '저장' })[0]);

  expect(await screen.findByText('이 영상은 더 이상 볼 수 없어요.')).toBeOnTheScreen();
});

test('저장한 영상이 없으면 빈 안내를 보여 준다', async () => {
  listSaved.mockResolvedValue({ entries: [] });
  await render(<SavedVideosScreen />);

  expect(await screen.findByText('아직 저장한 영상이 없어요')).toBeOnTheScreen();
  expect(screen.getByText('챌린지에서 마음에 드는 연기를 저장해 보세요')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: '저장한 영상 0' })).toBeOnTheScreen();
});

test('목록을 못 불러오면 실패 이유만 보여 주고 빈 안내는 띄우지 않는다', async () => {
  listMine.mockRejectedValue(Object.assign(new Error('nf'), { status: 404 }));
  await render(<SavedVideosScreen />);

  expect(await screen.findByText('없는 챌린지예요.')).toBeOnTheScreen();
  expect(screen.queryByText('아직 저장한 영상이 없어요')).not.toBeOnTheScreen();
});

test('뒤로 버튼은 이전 화면으로 돌아간다', async () => {
  await render(<SavedVideosScreen />);
  await fireEvent.press(screen.getByRole('button', { name: '뒤로' }));
  expect(mockRouter.back).toHaveBeenCalledTimes(1);
  await screen.findByText('눈빛 참고');
});

test('불러오기가 그 밖의 이유로 실패하면 InlineError 로 알리고 다시 시도로 다시 읽는다', async () => {
  listSaved.mockRejectedValueOnce(new ApiError(400, 'bad'));
  await render(<SavedVideosScreen />);
  expect(await screen.findByText('저장한 영상을 불러오지 못했어요')).toBeOnTheScreen();

  await fireEvent.press(screen.getByRole('button', { name: '다시 시도' }));
  expect(await screen.findByText('눈빛 참고')).toBeOnTheScreen();
  expect(screen.queryByText('저장한 영상을 불러오지 못했어요')).not.toBeOnTheScreen();
});
