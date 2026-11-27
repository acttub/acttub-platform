import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Share } from 'react-native';

import { InviteCard, InviteShareRow } from '@/components/invite-card';
import { logEvent } from '@/lib/analytics';
import { api } from '@/lib/api';

jest.mock('expo-router', () => ({
  useFocusEffect: (effect: () => void) => require('react').useEffect(effect, [effect]),
}));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { android: { package: 'com.acttub.app' } } } }));
jest.mock('@/lib/analytics', () => ({ logEvent: jest.fn() }));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { id: '11111111-1111-4111-8111-111111111111' } }) }));
jest.mock('@/lib/api', () => ({ api: { inviteMe: jest.fn(), redeemInviteCode: jest.fn() } }));
const mockStorage = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => mockStorage.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => void mockStorage.set(key, value)),
    removeItem: jest.fn(async (key: string) => void mockStorage.delete(key)),
  },
}));

const inviteMe = api.inviteMe as jest.Mock;
const redeem = api.redeemInviteCode as jest.Mock;
const log = logEvent as jest.Mock;

const me = {
  code: 'ABC234',
  can_redeem: true,
  redeem_until: '2026-11-30T00:00:00.000000Z',
  redeemed: false,
  rewarded: false,
  reward_count: 0,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockStorage.clear();
});

test('서버가 기능을 닫아 두었으면(404) 프로필 칸과 리딩 줄을 그리지 않는다', async () => {
  inviteMe.mockRejectedValue(Object.assign(new Error('invite_unavailable'), { status: 404, code: 'invite_unavailable' }));
  const card = await render(<InviteCard />);
  await act(async () => {});
  expect(inviteMe).toHaveBeenCalled();
  expect(screen.toJSON()).toBeNull();
  await card.unmount();

  await render(<InviteShareRow />);
  await act(async () => {});
  expect(inviteMe).toHaveBeenCalledTimes(2);
  expect(screen.toJSON()).toBeNull();
});

test('보상 조건 한 줄과 내 코드를 보이고, 공유 시트로 스토어 주소·코드·조건을 보낸다', async () => {
  inviteMe.mockResolvedValue({ ...me, can_redeem: false, redeem_until: null });
  const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction });
  await render(<InviteCard />);

  expect(await screen.findByText('친구가 가입하고 첫 연습을 끝내면 둘 다 Pro 1개월')).toBeTruthy();
  expect(screen.getByText('내 초대 코드 ABC234')).toBeTruthy();
  expect(screen.queryByText('초대 코드 입력')).toBeNull();

  await fireEvent.press(screen.getByText('친구 초대하기'));
  await act(async () => {});
  const message = share.mock.calls[0][0].message as string;
  expect(message).toContain('초대 코드: ABC234');
  expect(message).toContain('가입하고 첫 연습을 끝내면 둘 다 Pro 1개월을 받아요.');
  expect(message).toContain('https://play.google.com/store/apps/details?id=com.acttub.app');
  expect(log).toHaveBeenCalledWith('invite_share', { from: 'profile', result: 'shared' });
});

test('가입 7일 안이면 코드 입력 칸이 있고, 넣으면 서버 결과를 칸 아래 짧은 문구로 보인다', async () => {
  inviteMe.mockResolvedValue(me);
  redeem.mockRejectedValueOnce(Object.assign(new Error('own'), { status: 409, code: 'own_invite_code' }));
  await render(<InviteCard />);

  const input = await screen.findByLabelText('초대 코드 입력');
  await fireEvent.changeText(input, 'xy-z 789');
  expect(screen.getByLabelText('초대 코드 입력').props.value).toBe('XYZ789');
  await fireEvent.press(screen.getByText('확인'));
  await act(async () => {});
  expect(redeem).toHaveBeenCalledWith('XYZ789');
  expect(screen.getByText('내 코드는 넣을 수 없어요.')).toBeTruthy();
  expect(log).toHaveBeenCalledWith('invite_redeem_fail', { reason: 'own_code' });

  redeem.mockResolvedValueOnce({ ...me, can_redeem: false, redeem_until: null, redeemed: true });
  await fireEvent.press(screen.getByText('확인'));
  await act(async () => {});
  expect(screen.getByText('초대 코드를 넣었어요. 첫 연습을 끝내면 Pro 1개월을 받아요.')).toBeTruthy();
  expect(screen.queryByLabelText('초대 코드 입력')).toBeNull();
  expect(log).toHaveBeenCalledWith('invite_redeem_success');
});

test('딥링크로 받은 코드를 넣기 칸에 채워 두고, 자동으로 넣지는 않는다', async () => {
  mockStorage.set('acttub.invite.pendingCode', 'XYZ789');
  inviteMe.mockResolvedValue(me);
  await render(<InviteCard />);

  await waitFor(() => expect(screen.getByLabelText('초대 코드 입력').props.value).toBe('XYZ789'));
  expect(redeem).not.toHaveBeenCalled();
  expect(mockStorage.has('acttub.invite.pendingCode')).toBe(false);
});

test('보상 수가 늘었으면 지급 이벤트를 한 번 남긴다', async () => {
  inviteMe.mockResolvedValue({ ...me, can_redeem: false, redeem_until: null, redeemed: true, rewarded: true, reward_count: 1 });
  await render(<InviteCard />);

  expect(await screen.findByText('친구 초대 보상으로 Pro 1개월을 받았어요.')).toBeTruthy();
  await waitFor(() => expect(log).toHaveBeenCalledWith('invite_reward_granted', { count: 1 }));
});

test('리딩 끝 화면 줄은 같은 공유를 리딩에서 연 것으로 남긴다', async () => {
  inviteMe.mockResolvedValue(me);
  jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.dismissedAction });
  await render(<InviteShareRow />);

  await fireEvent.press(await screen.findByText('친구 초대하기'));
  await act(async () => {});
  expect(log).toHaveBeenCalledWith('invite_share', { from: 'reading_done', result: 'dismissed' });
});
