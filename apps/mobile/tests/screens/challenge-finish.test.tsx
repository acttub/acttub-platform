import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import ChallengeFinishScreen from '@/app/challenge-finish';
import { api } from '@/lib/api';

const mockRouter = { replace: jest.fn() };
let mockParams: Record<string, string> = {};

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@/lib/analytics', () => ({ logEvent: jest.fn() }));
jest.mock('@/lib/api', () => ({ api: { getChallenge: jest.fn(), getEntry: jest.fn() } }));
jest.mock('@/lib/challenge/intro-state', () => ({ hasFinishedFirstChallenge: jest.fn(async () => true) }));
jest.mock('@/lib/challenge/share-native', () => ({
  videoDeps: { download: jest.fn(), remove: jest.fn() },
  isInstagramInstalled: jest.fn(async () => true),
  instagramStoreUrl: jest.fn(() => null),
  shareVideoToInstagramStory: jest.fn(),
  saveVideoToLibrary: jest.fn(),
  copyText: jest.fn(),
  openSystemShare: jest.fn(),
  openUrl: jest.fn(),
}));

const mocked = api as unknown as { getChallenge: jest.Mock; getEntry: jest.Mock };

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = { challengeId: 'c1', entryId: 'e1' };
  mocked.getChallenge.mockResolvedValue({ id: 'c1', line: '잘 지내', ends_at: '2026-10-30T14:59:00Z', entry_count: 3, status: 'open' });
  mocked.getEntry.mockResolvedValue({
    id: 'e1', is_mine: true, published_at: '2026-10-20T00:00:00Z', playback_url: 'https://v/1.mp4', author: { name: '지성' },
  });
});

describe('챌린지 마무리 공유', () => {
  test('내 참여작 id 가 있으면 「SNS에 공유하기」로 공유 시트를 연다', async () => {
    await render(<ChallengeFinishScreen />);
    await fireEvent.press(await screen.findByText('SNS에 공유하기'));
    expect(await screen.findByText('내 연기 공유하기')).toBeOnTheScreen();
    expect(mocked.getEntry).toHaveBeenCalledWith('e1');
    expect(screen.getByText('영상으로 저장')).toBeOnTheScreen();
  });

  test('참여작 id 가 없으면 공유 버튼을 보이지 않는다', async () => {
    mockParams = { challengeId: 'c1' };
    await render(<ChallengeFinishScreen />);
    await waitFor(() => expect(mocked.getChallenge).toHaveBeenCalled());
    expect(screen.queryByText('SNS에 공유하기')).not.toBeOnTheScreen();
  });
});
