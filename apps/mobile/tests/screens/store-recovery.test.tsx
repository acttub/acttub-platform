import { act, render, waitFor } from '@testing-library/react-native';
import { AppState, Platform } from 'react-native';

import { useStoreRecovery } from '@/hooks/use-store-recovery';
import { api } from '@/lib/api';

const USER = 'u1';
const mockRc = {
  isConfigured: jest.fn(() => Promise.resolve(false)),
  configure: jest.fn(),
  getAppUserID: jest.fn(() => Promise.resolve('u1')),
  logIn: jest.fn(() => Promise.resolve({})),
  logOut: jest.fn(() => Promise.resolve({})),
  isAnonymous: jest.fn(() => Promise.resolve(false)),
  getCustomerInfo: jest.fn(),
};
jest.mock('react-native-purchases', () => ({
  __esModule: true,
  default: new Proxy({}, { get: (_t, name: string) => (...a: unknown[]) => (mockRc as Record<string, jest.Mock>)[name](...a) }),
}));
jest.mock('expo-application', () => ({ applicationId: 'com.acttub.app' }));
let mockUser: { id: string } | null = { id: 'u1' };
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('@/lib/api', () => ({ api: { billingMe: jest.fn(), syncStorePurchases: jest.fn() } }));

const billingMe = api.billingMe as jest.Mock;
const sync = api.syncStorePurchases as jest.Mock;
const entitled = { entitlements: { active: { pro: { identifier: 'pro' } }, all: {} } };
const nothing = { entitlements: { active: {}, all: {} } };

function Probe({ active }: { active: boolean }) {
  useStoreRecovery(active);
  return null;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { id: USER };
  mockRc.isConfigured.mockResolvedValue(false);
  Platform.OS = 'ios';
  process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY = 'appl_test';
});

test('결제는 됐는데 Pro 가 아니면 시작할 때 RevenueCat 을 우리 user id 로 열고, 활성 entitlement 가 있으면 서버 동기화를 부탁한다', async () => {
  billingMe.mockResolvedValue({ app_enabled: true, pro: false });
  mockRc.getCustomerInfo.mockResolvedValue(entitled);
  sync.mockResolvedValue({ pro: true });
  await render(<Probe active />);
  await waitFor(() => expect(sync).toHaveBeenCalledTimes(1));
  expect(mockRc.configure).toHaveBeenCalledWith({ apiKey: 'appl_test', appUserID: USER });
});

test('RevenueCat 에 활성 entitlement 가 없으면 서버를 부르지 않는다', async () => {
  billingMe.mockResolvedValue({ app_enabled: true, pro: false });
  mockRc.getCustomerInfo.mockResolvedValue(nothing);
  await render(<Probe active />);
  await waitFor(() => expect(mockRc.getCustomerInfo).toHaveBeenCalledTimes(1));
  expect(sync).not.toHaveBeenCalled();
});

test('이미 Pro 이거나 서버가 앱 결제를 닫았거나 키가 없는 빌드면 RevenueCat 을 건드리지 않는다', async () => {
  billingMe.mockResolvedValue({ app_enabled: true, pro: true });
  await render(<Probe active />);
  await waitFor(() => expect(billingMe).toHaveBeenCalledTimes(1));
  expect(mockRc.configure).not.toHaveBeenCalled();

  process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY = '';
  billingMe.mockClear();
  await render(<Probe active />);
  expect(billingMe).not.toHaveBeenCalled();
});

test('로그인 전(active=false)이거나 서버 동기화가 실패해도 앱이 멈추지 않는다', async () => {
  await render(<Probe active={false} />);
  expect(billingMe).not.toHaveBeenCalled();
  billingMe.mockResolvedValue({ app_enabled: true, pro: false });
  mockRc.getCustomerInfo.mockResolvedValue(entitled);
  sync.mockRejectedValue(Object.assign(new Error('taken'), { status: 409, code: 'already_subscribed' }));
  await render(<Probe active />);
  await waitFor(() => expect(sync).toHaveBeenCalledTimes(1));
});

test('로그아웃하면(사용자 없음) RevenueCat 에서도 빠진다 — 설정된 적이 있고 익명이 아닐 때만', async () => {
  mockUser = null;
  mockRc.isConfigured.mockResolvedValue(true);
  await render(<Probe active={false} />);
  await waitFor(() => expect(mockRc.logOut).toHaveBeenCalledTimes(1));

  mockRc.isConfigured.mockResolvedValue(false);
  await render(<Probe active={false} />);
  await act(async () => undefined);
  expect(mockRc.logOut).toHaveBeenCalledTimes(1);
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

test('스토어 구독이 이미 Pro 여도 시작할 때 서버에 다시 읽어 달라고 한다(해지 예약·만료 따라잡기, SOMA-851)', async () => {
  billingMe.mockResolvedValue({ app_enabled: true, pro: true, status: 'active', provider: 'google' });
  sync.mockResolvedValue({ pro: false, status: 'expired', provider: 'google' });
  await render(<Probe active />);
  await waitFor(() => expect(sync).toHaveBeenCalledTimes(1));
  expect(mockRc.getCustomerInfo).not.toHaveBeenCalled();
});
