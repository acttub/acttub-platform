import { act, render, waitFor } from '@testing-library/react-native';
import { AppState, Platform } from 'react-native';

import { useStoreRecovery } from '@/hooks/use-store-recovery';
import { api } from '@/lib/api';

const mockIap = {
  initConnection: jest.fn(() => Promise.resolve(true)),
  getAvailablePurchases: jest.fn(),
  finishTransaction: jest.fn(() => Promise.resolve()),
};
jest.mock('expo-iap', () => ({
  initConnection: (...a: unknown[]) => (mockIap.initConnection as jest.Mock)(...a),
  getAvailablePurchases: (...a: unknown[]) => (mockIap.getAvailablePurchases as jest.Mock)(...a),
  finishTransaction: (...a: unknown[]) => (mockIap.finishTransaction as jest.Mock)(...a),
}));
jest.mock('expo-application', () => ({ applicationId: 'com.acttub.app' }));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
jest.mock('@/lib/api', () => ({ api: { billingMe: jest.fn(), verifyStorePurchase: jest.fn() } }));

const billingMe = api.billingMe as jest.Mock;
const verify = api.verifyStorePurchase as jest.Mock;
const owned = { productId: 'acttub_pro_monthly', id: 't1', purchaseToken: 'jws' };

function Probe({ active }: { active: boolean }) {
  useStoreRecovery(active);
  return null;
}

beforeEach(() => {
  jest.clearAllMocks();
  Platform.OS = 'ios';
});

test('결제는 됐는데 Pro 가 아니면 시작할 때 스토어의 미완료 거래를 서버에 확인받고 끝낸다', async () => {
  billingMe.mockResolvedValue({ app_enabled: true, pro: false });
  mockIap.getAvailablePurchases.mockResolvedValue([owned, { productId: 'other', id: 'x', purchaseToken: 'y' }]);
  verify.mockResolvedValue({ pro: true });
  await render(<Probe active />);
  await waitFor(() => expect(mockIap.finishTransaction).toHaveBeenCalledTimes(1));
  expect(verify).toHaveBeenCalledTimes(1);
  expect(verify).toHaveBeenCalledWith({ platform: 'ios', product_id: 'acttub_pro_monthly', signed_transaction: 'jws' });
});

test('이미 Pro 이거나 서버가 앱 결제를 닫았으면 스토어를 건드리지 않는다', async () => {
  billingMe.mockResolvedValue({ app_enabled: true, pro: true });
  await render(<Probe active />);
  await waitFor(() => expect(billingMe).toHaveBeenCalledTimes(1));
  expect(mockIap.initConnection).not.toHaveBeenCalled();
});

test('로그인 전(active=false)이거나 서버 확인이 실패해도 앱이 멈추지 않는다', async () => {
  await render(<Probe active={false} />);
  expect(billingMe).not.toHaveBeenCalled();
  billingMe.mockResolvedValue({ app_enabled: true, pro: false });
  mockIap.getAvailablePurchases.mockResolvedValue([owned]);
  verify.mockRejectedValue(Object.assign(new Error('forbidden'), { status: 403, code: 'store_account_mismatch' }));
  await render(<Probe active />);
  await waitFor(() => expect(verify).toHaveBeenCalledTimes(1));
  expect(mockIap.finishTransaction).not.toHaveBeenCalled();
});

test('앱을 앞으로 가져올 때 간격(30초)이 지났으면 다시 확인한다', async () => {
  const now = jest.spyOn(Date, 'now');
  now.mockReturnValue(1_000_000);
  billingMe.mockResolvedValue({ app_enabled: false, pro: false });
  let listener: ((state: string) => void) | null = null;
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_: string, fn: (state: string) => void) => {
    listener = fn;
    return { remove: jest.fn() };
  }) as never);
  await render(<Probe active />);
  await waitFor(() => expect(billingMe).toHaveBeenCalledTimes(1));
  await act(async () => listener?.('active'));
  expect(billingMe).toHaveBeenCalledTimes(1);
  now.mockReturnValue(1_000_000 + 31_000);
  await act(async () => listener?.('active'));
  await waitFor(() => expect(billingMe).toHaveBeenCalledTimes(2));
  now.mockRestore();
});
