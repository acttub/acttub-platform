import { fireEvent, render, screen } from '@testing-library/react-native';

import ChallengeOthersScreen from '@/app/challenge-others';
import { api } from '@/lib/api';
import { challengeCard, entryCard, RUNNING_ENDS_AT } from '../helpers/challenge-card';

const mockRouter = { push: jest.fn() };
jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useRouter: () => mockRouter,
  useLocalSearchParams: () => ({ id: 'c1' }),
}));
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));
jest.mock('expo-video', () => ({
  useVideoPlayer: () => ({ play: jest.fn(), pause: jest.fn(), release: jest.fn() }),
  VideoView: () => null,
}));
jest.mock('@/lib/api', () => ({ api: { getChallenge: jest.fn(), listChallengeEntries: jest.fn() } }));
jest.mock('@/lib/analytics', () => ({ logEvent: jest.fn() }));

const getChallenge = api.getChallenge as jest.Mock;
const listEntries = api.listChallengeEntries as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  getChallenge.mockResolvedValue({ ...challengeCard({ ends_at: RUNNING_ENDS_AT, line: '잘 지내, 진짜로.' }), ranking_state: null });
});

describe('ChallengeOthersScreen (C1.17)', () => {
  test('참여작을 8칸까지 보여 주고 칸을 누르면 그 참여작부터 피드를 연다', async () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      entryCard({ id: `e${i}`, author: { name: `배우${i}`, user_id: `u${i}` }, playback_url: `https://v/${i}.mp4` }),
    );
    listEntries.mockResolvedValue({ entries: many, next_cursor: null, ranking_state: null });
    await render(<ChallengeOthersScreen />);
    await screen.findByText(/참여 3명/);
    expect(await screen.findByLabelText('배우7')).toBeOnTheScreen();
    expect(screen.queryByLabelText('배우8')).toBeNull();
    await fireEvent.press(screen.getByLabelText('배우3'));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/challenge-play', params: { id: 'c1', entryId: 'e3' } });
    await fireEvent.press(screen.getByText('더 보기'));
    expect(await screen.findByLabelText('배우9')).toBeOnTheScreen();
  });

  test('참여작이 없으면 빈 상태와 「나도 이 대사 연기하기」를 보여 준다', async () => {
    listEntries.mockResolvedValue({ entries: [], next_cursor: null, ranking_state: null });
    await render(<ChallengeOthersScreen />);
    expect(await screen.findByText('아직 참여작이 없어요')).toBeOnTheScreen();
    expect(screen.getByText('첫 번째로 참여해 보세요.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByText('나도 이 대사 연기하기'));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/record-video',
      params: { mode: 'challenge', challengeId: 'c1', line: '잘 지내, 진짜로.', work: '햄릿' },
    });
  });

  test('참여작을 못 불러오면 InlineError 를 보이고 다시 시도로 다시 받는다', async () => {
    listEntries
      .mockRejectedValueOnce(Object.assign(new Error('boom'), { status: 500 }))
      .mockResolvedValue({ entries: [entryCard({ id: 'e1', author: { name: '하은', user_id: 'u1' }, playback_url: 'https://v/1.mp4' })], next_cursor: null, ranking_state: null });
    await render(<ChallengeOthersScreen />);

    expect(await screen.findByText('참여작을 불러오지 못했어요')).toBeOnTheScreen();
    expect(screen.queryByText('아직 참여작이 없어요')).not.toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: '다시 시도' }));

    expect(await screen.findByLabelText('하은')).toBeOnTheScreen();
    expect(screen.queryByText('참여작을 불러오지 못했어요')).not.toBeOnTheScreen();
  });

  test('최신을 고르면 최신순으로 다시 받는다', async () => {
    listEntries.mockResolvedValue({ entries: [], next_cursor: null, ranking_state: null });
    await render(<ChallengeOthersScreen />);
    await fireEvent.press(await screen.findByRole('radio', { name: '최신' }));
    expect(listEntries).toHaveBeenLastCalledWith('c1', { sort: 'latest' });
    expect(screen.getByRole('radio', { name: '최신' }).props.accessibilityState.selected).toBe(true);
  });
});
