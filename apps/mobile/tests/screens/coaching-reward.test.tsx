import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import TalkScreen from '@/app/talk';
import { confirmReward } from '@/lib/ads';
import { logEvent } from '@/lib/analytics';
import { api } from '@/lib/api';
import { showRewarded } from '@/lib/full-screen-ad';

// 무료 코칭 한도 확인창의 「광고 보고 1회 더」(SOMA-1067) — 서버가 가능하다고 할 때만 보이고, 광고를 다 보고 지급이 확인되면 바로 다시 시작한다.

const mockRouter = { replace: jest.fn(), push: jest.fn() };
const USER = '11111111-1111-4111-8111-111111111111';

jest.mock('expo-router', () => ({ useRouter: () => mockRouter, Stack: { Screen: () => null } }));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('@/lib/analytics', () => ({ logEvent: jest.fn() }));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { id: '11111111-1111-4111-8111-111111111111' } }) }));
jest.mock('@/lib/practice/session-state', () => ({ startPractice: jest.fn() }));
jest.mock('@/lib/api', () => ({
  api: { createPractice: jest.fn(), listPracticeGroups: jest.fn(), coachingRewardStatus: jest.fn(), coachingRewardGranted: jest.fn() },
}));
jest.mock('@/lib/full-screen-ad', () => ({ showRewarded: jest.fn() }));
jest.mock('@/lib/ads', () => ({
  ...jest.requireActual('@/lib/ads'),
  // 시간 간격 없이 곧바로 묻는다.
  confirmReward: jest.fn((check: () => Promise<boolean>) =>
    jest.requireActual('@/lib/ads').confirmReward(check, () => Promise.resolve(), [0, 0]),
  ),
}));

const createPractice = api.createPractice as jest.Mock;
const status = api.coachingRewardStatus as jest.Mock;
const granted = api.coachingRewardGranted as jest.Mock;
const limit = () => Object.assign(new Error('limit'), { status: 429, code: 'free_daily_coaching_limit' });

beforeEach(() => {
  jest.clearAllMocks();
});

async function hitLimit() {
  await render(<TalkScreen />);
  await fireEvent.press(screen.getByRole('radio', { name: '고민 상담' }));
  await fireEvent.press(screen.getByRole('button', { name: '다음' }));
  expect(await screen.findByText('오늘 무료 코칭 3회를 다 썼어요')).toBeOnTheScreen();
}

test('서버가 보상 가능이라고 하면 Pro 안내와 함께 버튼이 보이고, 광고를 다 보고 지급이 확인되면 같은 목적으로 바로 다시 시작한다', async () => {
  createPractice.mockRejectedValueOnce(limit());
  createPractice.mockResolvedValueOnce({ id: 'p1', root_id: 'p1', ordinal: 1, stage: 'conversing', analysis_status: null, job: null });
  status.mockResolvedValue({ available: true });
  granted.mockResolvedValueOnce({ granted: false }).mockResolvedValueOnce({ granted: true });
  (showRewarded as jest.Mock).mockResolvedValue('earned');

  await hitLimit();
  expect(screen.getByText('Pro 알아보기')).toBeOnTheScreen();
  await fireEvent.press(await screen.findByText('광고 보고 1회 더'));

  await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/coach'));
  const [, , verification] = (showRewarded as jest.Mock).mock.calls[0];
  expect(verification.userId).toBe(USER);
  expect(granted).toHaveBeenCalledWith(verification.customData);
  expect(confirmReward).toHaveBeenCalled();
  expect(createPractice).toHaveBeenCalledTimes(2);
  expect(createPractice.mock.calls[1][0].session_purpose).toBe('concern');
  const events = (logEvent as jest.Mock).mock.calls.map(([name]) => name);
  expect(events).toEqual(expect.arrayContaining(['coaching_reward_shown', 'coaching_reward_click', 'coaching_reward_confirmed']));
});

test('서버가 보상 불가라고 하면 버튼이 없다', async () => {
  createPractice.mockRejectedValue(limit());
  status.mockResolvedValue({ available: false });
  await hitLimit();
  await waitFor(() => expect(status).toHaveBeenCalled());
  expect(screen.queryByText('광고 보고 1회 더')).not.toBeOnTheScreen();
});

test('광고를 중간에 닫거나 광고가 없거나 지급이 확인되지 않으면 짧은 안내만 보이고 다시 시작하지 않는다', async () => {
  createPractice.mockRejectedValue(limit());
  status.mockResolvedValue({ available: true });
  granted.mockResolvedValue({ granted: false });
  await hitLimit();

  (showRewarded as jest.Mock).mockResolvedValueOnce('closed');
  await fireEvent.press(await screen.findByText('광고 보고 1회 더'));
  expect(await screen.findByText('광고를 끝까지 봐야 1회가 더해져요.')).toBeOnTheScreen();

  (showRewarded as jest.Mock).mockResolvedValueOnce('failed');
  await fireEvent.press(screen.getByText('광고 보고 1회 더'));
  expect(await screen.findByText('지금은 볼 수 있는 광고가 없어요. 잠시 뒤에 다시 해 주세요.')).toBeOnTheScreen();

  (showRewarded as jest.Mock).mockResolvedValueOnce('earned');
  await fireEvent.press(screen.getByText('광고 보고 1회 더'));
  expect(await screen.findByText('아직 확인하지 못했어요. 잠시 뒤에 코칭을 다시 시작해 보세요.')).toBeOnTheScreen();

  expect(createPractice).toHaveBeenCalledTimes(1);
  expect(mockRouter.replace).not.toHaveBeenCalled();
  expect(logEvent).toHaveBeenCalledWith('coaching_reward_failed', { reason: 'closed' });
  expect(logEvent).toHaveBeenCalledWith('coaching_reward_failed', { reason: 'no_ad' });
  expect(logEvent).toHaveBeenCalledWith('coaching_reward_failed', { reason: 'unconfirmed' });
});
