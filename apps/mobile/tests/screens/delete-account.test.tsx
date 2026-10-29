import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import DeleteAccountScreen from '@/app/delete-account';
import { useAuth } from '@/lib/auth';

const mockBack = jest.fn();
const mockReplace = jest.fn();
const mockCanGoBack = jest.fn(() => true);
jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useRouter: () => ({ back: mockBack, replace: mockReplace, canGoBack: mockCanGoBack }),
}));
jest.mock('@/lib/auth', () => ({ useAuth: jest.fn() }));
const mockBillingMe = jest.fn();
jest.mock('@/lib/api', () => ({ api: { billingMe: () => mockBillingMe() } }));
const mockOpenStore = jest.fn(() => Promise.resolve());
jest.mock('@/hooks/use-store-purchase', () => ({ openStoreSubscriptions: () => mockOpenStore() }));

const deleteAccount = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (useAuth as jest.Mock).mockReturnValue({ user: { email: 'me@acttub.app' }, deleteAccount });
  mockBillingMe.mockRejectedValue(Object.assign(new Error('closed'), { status: 404, code: 'billing_unavailable' }));
});

const STORE_NOTE = 'App Store·Google Play에서 산 구독은 탈퇴해도 해지되지 않아요. 스토어 구독 관리에서 따로 해지해 주세요.';
const billing = (provider: string | null, status: string) => ({
  status, pro: status !== 'expired', amount: 3900, period_end: null, next_billing_at: null, card_company: null,
  card_last4: null, retry_count: 0, limits_enforced: true, provider,
});

test('스토어 구독은 탈퇴해도 해지되지 않는다고 누구에게나 알리고, 결제가 닫혀 있으면 링크는 없다', async () => {
  await render(<DeleteAccountScreen />);
  expect(screen.getByText('스토어 구독')).toBeOnTheScreen();
  expect(screen.getByText(STORE_NOTE)).toBeOnTheScreen();
  await waitFor(() => expect(mockBillingMe).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole('link', { name: '스토어에서 구독 관리' })).not.toBeOnTheScreen();
});

test('스토어 구독이 돌고 있으면 화면 안에 「스토어에서 구독 관리」 링크를 보이고 누르면 스토어 구독 관리를 연다', async () => {
  mockBillingMe.mockResolvedValue(billing('google', 'active'));
  await render(<DeleteAccountScreen />);
  const link = await screen.findByRole('link', { name: '스토어에서 구독 관리' });
  await fireEvent.press(link);
  expect(mockOpenStore).toHaveBeenCalledTimes(1);
});

test('웹(토스) 구독이나 이미 해지한 스토어 구독에는 스토어 링크를 보이지 않는다', async () => {
  for (const me of [billing('toss', 'active'), billing('apple', 'canceled'), billing(null, 'none')]) {
    mockBillingMe.mockResolvedValue(me);
    const view = await render(<DeleteAccountScreen />);
    await waitFor(() => expect(mockBillingMe).toHaveBeenCalled());
    expect(screen.queryByRole('link', { name: '스토어에서 구독 관리' })).not.toBeOnTheScreen();
    expect(screen.getByText(STORE_NOTE)).toBeOnTheScreen();
    await view.unmount();
    mockBillingMe.mockClear();
  }
});

test('확인 줄을 눌러야 탈퇴 버튼이 켜지고, 두 번 확인하면 계정을 지운다', async () => {
  deleteAccount.mockResolvedValue(undefined);
  await render(<DeleteAccountScreen />);

  expect(screen.getByText('me@acttub.app')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: '탈퇴하기' })).toBeDisabled();

  await fireEvent.press(screen.getByRole('checkbox', { name: /연습·노트는 돌아오지 않아요/ }));
  expect(screen.getByRole('checkbox')).toBeChecked();
  await fireEvent.press(screen.getByRole('button', { name: '탈퇴하기' }));

  expect(await screen.findByText('정말 탈퇴할까요?')).toBeOnTheScreen();
  const labels = screen.getAllByText('탈퇴하기');
  await fireEvent.press(labels[labels.length - 1]);

  await waitFor(() => expect(deleteAccount).toHaveBeenCalledTimes(1));
  expect(screen.queryByText('정말 탈퇴할까요?')).not.toBeOnTheScreen();
  expect(screen.getByRole('button', { name: '그대로 쓸게요' })).toBeDisabled();
});

test('확인 창에서 취소하면 지우지 않는다', async () => {
  await render(<DeleteAccountScreen />);
  await fireEvent.press(screen.getByRole('checkbox'));
  await fireEvent.press(screen.getByRole('button', { name: '탈퇴하기' }));
  await fireEvent.press(await screen.findByText('취소'));

  expect(screen.queryByText('정말 탈퇴할까요?')).not.toBeOnTheScreen();
  expect(deleteAccount).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: '탈퇴하기' })).toBeEnabled();
});

test('탈퇴가 실패하면 서버 문구와 함께 계정이 남았다고 알린다', async () => {
  deleteAccount.mockRejectedValue(new Error('서버 점검 중'));
  await render(<DeleteAccountScreen />);
  await fireEvent.press(screen.getByRole('checkbox'));
  await fireEvent.press(screen.getByRole('button', { name: '탈퇴하기' }));
  const labels = await screen.findAllByText('탈퇴하기');
  await fireEvent.press(labels[labels.length - 1]);

  expect(await screen.findByText('탈퇴하지 못했어요')).toBeOnTheScreen();
  expect(screen.getByText('서버 점검 중\n계정은 그대로 있어요.')).toBeOnTheScreen();
});

test('오류 객체가 아니면 일반 실패 문구를 보여 준다', async () => {
  (useAuth as jest.Mock).mockReturnValue({ user: null, deleteAccount });
  deleteAccount.mockRejectedValue('boom');
  await render(<DeleteAccountScreen />);
  expect(screen.queryByText('me@acttub.app')).not.toBeOnTheScreen();

  await fireEvent.press(screen.getByRole('checkbox'));
  await fireEvent.press(screen.getByRole('button', { name: '탈퇴하기' }));
  const labels = await screen.findAllByText('탈퇴하기');
  await fireEvent.press(labels[labels.length - 1]);

  expect(await screen.findByText('잠시 후 다시 시도해 주세요. 계정은 그대로 있어요.')).toBeOnTheScreen();
});

test('그대로 쓰기를 누르면 이전 화면으로 돌아간다', async () => {
  await render(<DeleteAccountScreen />);
  await fireEvent.press(screen.getByRole('button', { name: '그대로 쓸게요' }));
  expect(mockBack).toHaveBeenCalledTimes(1);
});

test('돌아갈 화면 없이 열었으면 꺾쇠와 「그대로 쓸게요」 모두 설정으로 간다', async () => {
  mockCanGoBack.mockReturnValue(false);
  await render(<DeleteAccountScreen />);
  await fireEvent.press(screen.getByRole('button', { name: '뒤로' }));
  await fireEvent.press(screen.getByRole('button', { name: '그대로 쓸게요' }));
  expect(mockReplace.mock.calls).toEqual([['/settings'], ['/settings']]);
  expect(mockBack).not.toHaveBeenCalled();
  mockCanGoBack.mockReturnValue(true);
});
