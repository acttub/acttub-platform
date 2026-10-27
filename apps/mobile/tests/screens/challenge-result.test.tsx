import { fireEvent, render, screen } from '@testing-library/react-native';

import ChallengeResultScreen from '@/app/challenge-result';
import { api } from '@/lib/api';
import { translate as t } from '@/lib/i18n';

const mockRouter = { dismissTo: jest.fn(), replace: jest.fn(), back: jest.fn() };
let mockParams: { id?: string; nextId?: string } = {};
jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@/lib/analytics', () => ({ logEvent: jest.fn() }));
jest.mock('@/lib/api', () => ({
  api: { getChallenge: jest.fn(), listChallengeEntries: jest.fn(), listMyChallengeEntries: jest.fn() },
}));

beforeEach(() => {
  jest.clearAllMocks();
  (api.getChallenge as jest.Mock).mockRejectedValue(Object.assign(new Error('boom'), { status: 500 }));
  (api.listChallengeEntries as jest.Mock).mockResolvedValue({ entries: [] });
  (api.listMyChallengeEntries as jest.Mock).mockRejectedValue(new Error('boom'));
});

test('다음 챌린지가 있으면 「챌린지 보기」는 이미 있는 챌린지 탭까지 내려간다 — 탭 묶음을 하나 더 쌓지 않는다(SOMA-853)', async () => {
  mockParams = { id: 'c1', nextId: 'c2' };
  await render(<ChallengeResultScreen />);

  await fireEvent.press(screen.getByText(t('challengeResult.seeChallenges')));
  expect(mockRouter.dismissTo).toHaveBeenCalledWith('/challenges');
  expect(mockRouter.replace).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByText(t('challengeResult.seeWeek')));
  expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/challenge-detail', params: { id: 'c2' } });
});

test('다음 챌린지가 없으면 버튼은 하나이고 누르면 뒤로 간다', async () => {
  mockParams = { id: 'c1' };
  await render(<ChallengeResultScreen />);

  await fireEvent.press(screen.getByText(t('challengeResult.seeChallenges')));
  expect(mockRouter.back).toHaveBeenCalledTimes(1);
  expect(mockRouter.dismissTo).not.toHaveBeenCalled();
});

test('불러오지 못하면 InlineError 를 보이고 다시 시도로 다시 읽는다', async () => {
  mockParams = { id: 'c1' };
  (api.getChallenge as jest.Mock)
    .mockRejectedValueOnce(Object.assign(new Error('boom'), { status: 500 }))
    .mockResolvedValue({
      id: 'c1',
      line: '이게 최선이야?',
      starts_at: '2026-10-15T00:00:00+09:00',
      ends_at: '2026-10-22T00:00:00+09:00',
      ranking_state: 'final',
    });
  await render(<ChallengeResultScreen />);

  expect(await screen.findByText('연결이 끊겼어요. 잠시 뒤 다시 시도해 주세요.')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: '다시 시도' }));

  expect(await screen.findByText('“이게 최선이야?”')).toBeOnTheScreen();
  expect(screen.getByText('좋아요를 받은 참여작이 없어 선정작이 없어요')).toBeOnTheScreen();
  expect(screen.getByText('이번에는 참여하지 않았어요.')).toBeOnTheScreen();
});

test('없는 챌린지면 다시 시도 없이 한 줄로 알린다', async () => {
  mockParams = { id: 'c1' };
  (api.getChallenge as jest.Mock).mockRejectedValue(Object.assign(new Error('nf'), { status: 404 }));
  await render(<ChallengeResultScreen />);
  expect(await screen.findByText('없는 챌린지예요.')).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: '다시 시도' })).not.toBeOnTheScreen();
});

test('내 참여작은 공개 범위와 좋아요·순위를 보인다', async () => {
  mockParams = { id: 'c1' };
  (api.getChallenge as jest.Mock).mockResolvedValue({
    id: 'c1',
    line: '이게 최선이야?',
    starts_at: '2026-10-15T00:00:00+09:00',
    ends_at: '2026-10-22T00:00:00+09:00',
    ranking_state: 'final',
  });
  (api.listMyChallengeEntries as jest.Mock).mockResolvedValue({
    entries: [{ challenge: { id: 'c1' }, category: 'public', visibility: 'public', like_count: 12, final_like_count: 12, rank: 8 }],
  });
  await render(<ChallengeResultScreen />);
  expect(await screen.findByText('공개')).toBeOnTheScreen();
  expect(screen.getByText('좋아요 12 · 8위')).toBeOnTheScreen();
});
