import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

import ProScreen from '@/app/pro';
import ProDoneScreen from '@/app/pro-done';
import ProManageScreen from '@/app/pro-manage';
import SettingsScreen from '@/app/settings';
import TalkScreen from '@/app/talk';
import { api } from '@/lib/api';

const mockRouter = { back: jest.fn(), push: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => true) };
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
  useFocusEffect: (effect: () => void) => require('react').useEffect(effect, [effect]),
}));
jest.mock('expo-image', () => ({ Image: () => null }));
const mockIap = {
  purchaseUpdated: null as null | ((purchase: Record<string, unknown>) => void),
  purchaseError: null as null | ((error: { code: string }) => void),
  initConnection: jest.fn(() => Promise.resolve(true)),
  endConnection: jest.fn(() => Promise.resolve(true)),
  fetchProducts: jest.fn(),
  requestPurchase: jest.fn(() => Promise.resolve(null)),
  finishTransaction: jest.fn(() => Promise.resolve()),
  getAvailablePurchases: jest.fn(),
  deepLinkToSubscriptions: jest.fn(() => Promise.resolve()),
};
jest.mock('expo-iap', () => ({
  ErrorCode: { UserCancelled: 'user-cancelled' },
  initConnection: (...a: unknown[]) => (mockIap.initConnection as jest.Mock)(...a),
  endConnection: (...a: unknown[]) => (mockIap.endConnection as jest.Mock)(...a),
  fetchProducts: (...a: unknown[]) => (mockIap.fetchProducts as jest.Mock)(...a),
  requestPurchase: (...a: unknown[]) => (mockIap.requestPurchase as jest.Mock)(...a),
  finishTransaction: (...a: unknown[]) => (mockIap.finishTransaction as jest.Mock)(...a),
  getAvailablePurchases: (...a: unknown[]) => (mockIap.getAvailablePurchases as jest.Mock)(...a),
  deepLinkToSubscriptions: (...a: unknown[]) => (mockIap.deepLinkToSubscriptions as jest.Mock)(...a),
  purchaseUpdatedListener: (listener: (purchase: Record<string, unknown>) => void) => {
    mockIap.purchaseUpdated = listener;
    return { remove: jest.fn() };
  },
  purchaseErrorListener: (listener: (error: { code: string }) => void) => {
    mockIap.purchaseError = listener;
    return { remove: jest.fn() };
  },
}));
jest.mock('expo-application', () => ({ applicationId: 'com.acttub.app' }));
jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn(), openBrowserAsync: jest.fn() }));
jest.mock('@/lib/analytics', () => ({ logEvent: jest.fn(() => Promise.resolve()) }));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ signOut: jest.fn(), user: { id: '11111111-1111-4111-8111-111111111111' } }) }));
jest.mock('@/lib/reading/voice-feedback-setting', () => ({
  loadVoiceFeedbackEnabled: jest.fn(() => Promise.resolve(false)),
  saveVoiceFeedbackEnabled: jest.fn(),
}));
jest.mock('@/lib/practice/session-state', () => ({ startPractice: jest.fn() }));
jest.mock('@/lib/api', () => ({
  api: {
    billingMe: jest.fn(),
    verifyStorePurchase: jest.fn(),
    createPractice: jest.fn(),
    listPracticeGroups: jest.fn(),
  },
}));

const billingMe = api.billingMe as jest.Mock;
const verifyStorePurchase = api.verifyStorePurchase as jest.Mock;
const USER = '11111111-1111-4111-8111-111111111111';

const active = {
  status: 'active',
  pro: true,
  amount: 3900,
  period_end: '2026-11-23T01:00:00Z',
  next_billing_at: '2026-11-23T01:00:00Z',
  card_company: '신한',
  card_last4: '1234',
  retry_count: 0,
  limits_enforced: false,
  provider: 'toss',
  app_enabled: false,
};
const none = { ...active, status: 'none', pro: false, provider: null, period_end: null, next_billing_at: null, card_company: null, card_last4: null };

beforeEach(() => {
  jest.clearAllMocks();
  mockIap.purchaseUpdated = null;
  mockIap.purchaseError = null;
  mockParams = {};
  Platform.OS = 'android';
});

test('Pro 안내(P0xJ9) — 앱 결제가 닫혀 있으면 비교 표와 가격만 있고 구매 버튼과 웹 결제 링크는 없다', async () => {
  billingMe.mockResolvedValue({ ...none, app_enabled: false });
  await render(<ProScreen />);

  expect(screen.getByText('ACTTUB Pro')).toBeOnTheScreen();
  expect(screen.getByText('하루 1번')).toBeOnTheScreen();
  expect(screen.getByText('월 3,900원 · 매월 자동 결제 · 언제든 해지')).toBeOnTheScreen();
  expect(screen.queryByText('Pro 시작하기')).not.toBeOnTheScreen();
  expect(screen.queryByText(/acttub\.com\/pricing/)).not.toBeOnTheScreen();
  expect(mockIap.initConnection).not.toHaveBeenCalled();
});

const storeProduct = {
  id: 'acttub_pro_monthly',
  displayPrice: '₩3,900',
  subscriptionOffers: [{ id: 'monthly', basePlanIdAndroid: 'monthly', offerTokenAndroid: 'offer-1' }],
};

test('스토어 구독(Android) — 상품명·현지화 가격·자동 갱신·해지 방법·약관이 보이고, 구매는 obfuscatedAccountId 를 싣고 서버 확인 뒤 완료 화면으로 간다', async () => {
  billingMe.mockResolvedValue({ ...none, app_enabled: true });
  mockIap.fetchProducts.mockResolvedValue([storeProduct]);
  verifyStorePurchase.mockResolvedValue({ ...active, provider: 'google' });
  await render(<ProScreen />);

  expect(await screen.findByText('₩3,900 / 월')).toBeOnTheScreen();
  expect(screen.getByText('ACTTUB Pro 월 구독')).toBeOnTheScreen();
  expect(screen.getByText(/1개월마다 자동으로 갱신돼요.*Play 스토어 > 결제 및 정기 결제/)).toBeOnTheScreen();
  expect(screen.getByText('이용약관·개인정보 처리방침')).toBeOnTheScreen();
  expect(screen.queryByText(/acttub\.com\/pricing/)).not.toBeOnTheScreen();

  await fireEvent.press(screen.getByText('Pro 시작하기'));
  expect(mockIap.requestPurchase).toHaveBeenCalledWith({
    type: 'subs',
    request: {
      apple: { sku: 'acttub_pro_monthly', appAccountToken: USER },
      google: {
        skus: ['acttub_pro_monthly'],
        obfuscatedAccountId: USER,
        subscriptionOffers: [{ sku: 'acttub_pro_monthly', offerToken: 'offer-1' }],
      },
    },
  });
  expect(await screen.findByText('결제창을 여는 중이에요')).toBeOnTheScreen();

  await act(async () => {
    mockIap.purchaseUpdated?.({ productId: 'acttub_pro_monthly', id: 'o1', purchaseToken: 'play-token' });
  });
  await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/pro-done'));
  expect(verifyStorePurchase).toHaveBeenCalledWith({
    platform: 'android',
    product_id: 'acttub_pro_monthly',
    purchase_token: 'play-token',
  });
  // Android 승인은 서버가 한다 — 앱은 거래를 끝내지 않는다.
  expect(mockIap.finishTransaction).not.toHaveBeenCalled();
});

test('스토어 구독(iOS) — 서버 확인이 OK 한 뒤에만 거래를 끝낸다. 서버가 못 받으면 끝내지 않고 안내만 한다', async () => {
  Platform.OS = 'ios';
  billingMe.mockResolvedValue({ ...none, app_enabled: true });
  mockIap.fetchProducts.mockResolvedValue([storeProduct]);
  verifyStorePurchase.mockRejectedValue(Object.assign(new Error('closed'), { status: 403, code: 'store_account_mismatch' }));
  await render(<ProScreen />);
  expect(await screen.findByText('₩3,900 / 월')).toBeOnTheScreen();
  expect(screen.getByText(/Apple 계정/)).toBeOnTheScreen();

  await act(async () => {
    mockIap.purchaseUpdated?.({ productId: 'acttub_pro_monthly', id: 't1', purchaseToken: 'jws-token' });
  });
  expect(await screen.findByText(/다른 ACTTUB 계정으로 결제했어요/)).toBeOnTheScreen();
  expect(mockIap.finishTransaction).not.toHaveBeenCalled();
  expect(mockRouter.replace).not.toHaveBeenCalled();

  verifyStorePurchase.mockResolvedValue({ ...active, provider: 'apple' });
  await act(async () => {
    mockIap.purchaseUpdated?.({ productId: 'acttub_pro_monthly', id: 't2', purchaseToken: 'jws-token-2' });
  });
  await waitFor(() => expect(mockIap.finishTransaction).toHaveBeenCalledTimes(1));
  expect(verifyStorePurchase).toHaveBeenLastCalledWith({
    platform: 'ios',
    product_id: 'acttub_pro_monthly',
    signed_transaction: 'jws-token-2',
  });
});

test('스토어 구독 — 사용자가 결제를 취소하면 오류 없이 버튼이 돌아오고, 다른 상품 거래는 무시한다', async () => {
  billingMe.mockResolvedValue({ ...none, app_enabled: true });
  mockIap.fetchProducts.mockResolvedValue([storeProduct]);
  await render(<ProScreen />);
  await fireEvent.press(await screen.findByText('Pro 시작하기'));
  await act(async () => {
    mockIap.purchaseError?.({ code: 'user-cancelled' });
  });
  expect(await screen.findByText('Pro 시작하기')).toBeOnTheScreen();
  expect(screen.queryByText(/스토어에 연결하지 못했어요/)).not.toBeOnTheScreen();
  await act(async () => {
    mockIap.purchaseUpdated?.({ productId: 'other', id: 'x', purchaseToken: 'y' });
  });
  expect(verifyStorePurchase).not.toHaveBeenCalled();
});

test('구매 복원 — 스토어에서 읽은 구독을 서버에 확인받고, 없으면 안내한다', async () => {
  billingMe.mockResolvedValue({ ...none, app_enabled: true });
  mockIap.fetchProducts.mockResolvedValue([storeProduct]);
  mockIap.getAvailablePurchases.mockResolvedValueOnce([]);
  await render(<ProScreen />);
  await fireEvent.press(await screen.findByText('구매 복원'));
  expect(await screen.findByText('복원할 구독이 없어요')).toBeOnTheScreen();

  mockIap.getAvailablePurchases.mockResolvedValueOnce([{ productId: 'acttub_pro_monthly', id: 'o9', purchaseToken: 'restored' }]);
  verifyStorePurchase.mockResolvedValue({ ...active, provider: 'google' });
  await fireEvent.press(screen.getByText('구매 복원'));
  await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/pro-done'));
  expect(verifyStorePurchase).toHaveBeenCalledWith(expect.objectContaining({ purchase_token: 'restored' }));
});

test('이미 Pro(웹 결제 등)이면 구매 버튼 대신 상태 문구만 보이고 스토어에 연결하지 않는다', async () => {
  billingMe.mockResolvedValue({ ...active, app_enabled: true });
  await render(<ProScreen />);
  expect(await screen.findByText('이미 Pro를 이용 중이에요')).toBeOnTheScreen();
  expect(screen.queryByText('Pro 시작하기')).not.toBeOnTheScreen();
  expect(screen.queryByText('구매 복원')).not.toBeOnTheScreen();
  expect(mockIap.initConnection).not.toHaveBeenCalled();
});

test('구독 관리 — 스토어 구독이면 「스토어에서 구독 관리」가 스토어 구독 관리 화면(상품·패키지)을 연다', async () => {
  billingMe.mockResolvedValue({ ...active, provider: 'google' });
  await render(<ProManageScreen />);
  await fireEvent.press(await screen.findByText('스토어에서 구독 관리'));
  expect(mockIap.deepLinkToSubscriptions).toHaveBeenCalledWith({
    skuAndroid: 'acttub_pro_monthly',
    packageNameAndroid: 'com.acttub.app',
  });
});

test('결제 완료(kqeG6) — [계속하기]는 들어온 곳으로 돌아간다', async () => {
  await render(<ProDoneScreen />);
  expect(screen.getByText('이제 Pro예요!')).toBeOnTheScreen();
  await fireEvent.press(screen.getByText('계속하기'));
  expect(mockRouter.back).toHaveBeenCalled();
});

test('구독 관리(GmTw6) — 웹에서 결제한 구독은 상태와 「웹에서 결제한 구독이에요」만, 변경·해지 버튼과 링크는 없다', async () => {
  billingMe.mockResolvedValue(active);
  await render(<ProManageScreen />);
  expect(await screen.findByText('다음 결제 11월 23일 · 3,900원 · 신한카드 ····1234')).toBeOnTheScreen();
  expect(screen.getByText('웹에서 결제한 구독이에요')).toBeOnTheScreen();
  expect(screen.queryByText('자동결제 해지')).not.toBeOnTheScreen();
  expect(screen.queryByText('결제 수단 바꾸기')).not.toBeOnTheScreen();
  expect(screen.queryByText(/acttub\.com/)).not.toBeOnTheScreen();
});

test('구독 관리 — 서버가 결제 기능을 닫았으면 나간다', async () => {
  billingMe.mockRejectedValue(Object.assign(new Error('closed'), { status: 404, code: 'billing_unavailable' }));
  await render(<ProManageScreen />);
  await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
});

test('설정 — 앱 Pro 스위치가 켜져 있으면 「ACTTUB Pro」 줄이 Pro 안내로 간다', async () => {
  billingMe.mockResolvedValue({ ...none, app_enabled: true });
  await render(<SettingsScreen />);
  await fireEvent.press(await screen.findByText('무료 이용 중 · Pro 알아보기'));
  expect(mockRouter.push).toHaveBeenCalledWith('/pro');
});

test('설정 — 앱 스위치가 꺼져 있어도 웹에서 결제한 사람에게는 구독 관리 줄이 보인다', async () => {
  billingMe.mockResolvedValueOnce(active);
  await render(<SettingsScreen />);
  await fireEvent.press(await screen.findByText('Pro 이용 중'));
  expect(mockRouter.push).toHaveBeenCalledWith('/pro-manage');
});

test('설정 — 앱 스위치가 꺼져 있고 Pro 도 아니면 구매 진입이 없다', async () => {
  billingMe.mockResolvedValue(none);
  await render(<SettingsScreen />);
  await waitFor(() => expect(billingMe).toHaveBeenCalled());
  expect(screen.queryByText('ACTTUB Pro')).not.toBeOnTheScreen();
});

test('설정 — 결제 기능이 닫혀 있으면(404) 줄이 없다', async () => {
  billingMe.mockRejectedValue(Object.assign(new Error('closed'), { status: 404, code: 'billing_unavailable' }));
  await render(<SettingsScreen />);
  await waitFor(() => expect(billingMe).toHaveBeenCalled());
  expect(screen.queryByText('ACTTUB Pro')).not.toBeOnTheScreen();
});

test('코칭 시작이 무료 한도(free_daily_coaching_limit)에 걸리면 「오늘 무료 코칭을 다 썼어요」 시트(a5y1Qr)', async () => {
  (api.createPractice as jest.Mock).mockRejectedValue(
    Object.assign(new Error('limit'), { status: 429, code: 'free_daily_coaching_limit' }),
  );
  await render(<TalkScreen />);
  await fireEvent.press(screen.getByText('고민 상담'));
  await fireEvent.press(screen.getByText('다음'));
  expect(await screen.findByText('오늘 무료 코칭을 다 썼어요')).toBeOnTheScreen();
  await fireEvent.press(screen.getByText('Pro 알아보기'));
  expect(mockRouter.push).toHaveBeenCalledWith('/pro');
});
