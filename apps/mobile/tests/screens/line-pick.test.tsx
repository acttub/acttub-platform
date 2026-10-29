import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import LinePickScreen from '@/app/line-pick';
import { api } from '@/lib/api';
import { challengeCard, RUNNING_ENDS_AT } from '../helpers/challenge-card';

const mockRouter = { replace: jest.fn(), push: jest.fn() };
let mockParams: Record<string, string | undefined> = {};
jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));
jest.mock('expo-video', () => {
  const { Text } = require('react-native');
  return {
    useVideoPlayer: () => ({ play: jest.fn(), pause: jest.fn(), release: jest.fn() }),
    VideoView: (props: { style?: unknown; onFirstFrameRender?: () => void }) => (
      <Text testID="example-video" style={props.style as never} onPress={props.onFirstFrameRender}>
        예시 영상
      </Text>
    ),
  };
});
jest.mock('@/lib/api', () => ({ api: { listChallenges: jest.fn(), listChallengeEntries: jest.fn() } }));
jest.mock('@/lib/analytics', () => ({ logEvent: jest.fn() }));

const list = api.listChallenges as jest.Mock;
const entries = api.listChallengeEntries as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  entries.mockResolvedValue({ entries: [], next_cursor: null, ranking_state: null });
});

describe('LinePickScreen (C9.16)', () => {
  test('목록에서 진행 중인 대사를 고르면 대사와 영상 id 를 올리기로 넘긴다', async () => {
    mockParams = { videoId: 'v1' };
    list.mockResolvedValue({
      featured: null,
      challenges: [challengeCard({ id: 'c7', line: '사느냐 죽느냐', work: '햄릿', ends_at: RUNNING_ENDS_AT })],
      next_cursor: null,
    });
    await render(<LinePickScreen />);
    await fireEvent.press(await screen.findByLabelText('사느냐 죽느냐'));
    expect(mockRouter.replace).toHaveBeenCalledWith({
      pathname: '/challenge-upload',
      params: { challengeId: 'c7', line: '사느냐 죽느냐', work: '햄릿', videoId: 'v1' },
    });
  });

  test('이번 주 대사 「나도 이 대사 연기하기」와 직접 등록하기가 동작한다', async () => {
    list.mockResolvedValue({
      featured: challengeCard({ id: 'f1', line: '잘 지내, 진짜로.', ends_at: RUNNING_ENDS_AT }),
      challenges: [],
      next_cursor: null,
    });
    await render(<LinePickScreen />);
    await fireEvent.press(await screen.findByText('나도 이 대사 연기하기'));
    expect(mockRouter.replace).toHaveBeenCalledWith({
      pathname: '/challenge-upload',
      params: { challengeId: 'f1', line: '잘 지내, 진짜로.', work: '햄릿' },
    });
    await fireEvent.press(screen.getByText('찾는 대사가 없나요? 직접 등록하기'));
    expect(mockRouter.push).toHaveBeenCalledWith('/line-new');
    await waitFor(() => expect(entries).toHaveBeenCalled());
  });

  test('끝난 대사는 고를 수 없다', async () => {
    list.mockResolvedValue({ featured: null, challenges: [challengeCard({ id: 'e1', line: '지난 대사' })], next_cursor: null });
    await render(<LinePickScreen />);
    await fireEvent.press(await screen.findByText(/지난 대사/));
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  test('예시 영상은 첫 장면이 그려지기 전에는 숨겨 검은 상자가 보이지 않는다', async () => {
    list.mockResolvedValue({
      featured: challengeCard({ id: 'f1', line: '잘 지내, 진짜로.', ends_at: RUNNING_ENDS_AT }),
      challenges: [],
      next_cursor: null,
    });
    entries.mockResolvedValue({ entries: [{ id: 'e1', playback_url: 'https://cdn.example/e1.mp4' }], next_cursor: null, ranking_state: null });
    await render(<LinePickScreen />);
    const video = await screen.findByTestId('example-video');
    expect(video).toHaveStyle({ opacity: 0 });
    await act(async () => video.props.onPress());
    expect(screen.getByTestId('example-video')).toHaveStyle({ opacity: 1 });
  });

  test('목록을 못 불러오면 InlineError 의 다시 시도로 같은 탭을 다시 묻고, 비었으면 그렇게 말한다', async () => {
    list.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ featured: null, challenges: [], next_cursor: null });
    await render(<LinePickScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: '다시 시도' }));
    expect(await screen.findByText('올릴 수 있는 대사가 없어요')).toBeOnTheScreen();
    expect(list.mock.calls).toEqual([[{ tab: 'popular' }], [{ tab: 'popular' }]]);
  });
});
