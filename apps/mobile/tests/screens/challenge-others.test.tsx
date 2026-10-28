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
    expect(await screen.findByText('아직 올라온 참여작이 없어요. 첫 번째로 올려 봐요.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByText('나도 이 대사 연기하기'));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/record-video',
      params: { mode: 'challenge', challengeId: 'c1', line: '잘 지내, 진짜로.', work: '햄릿' },
    });
  });
});
