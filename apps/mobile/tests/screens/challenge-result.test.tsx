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
