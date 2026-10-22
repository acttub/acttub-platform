import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

import BillingResultScreen from '@/app/billing-result';
import ProScreen from '@/app/pro';
import ProDoneScreen from '@/app/pro-done';
import ProFailedScreen from '@/app/pro-failed';
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
jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn(), openBrowserAsync: jest.fn() }));
jest.mock('@/lib/analytics', () => ({ logEvent: jest.fn(() => Promise.resolve()) }));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ signOut: jest.fn() }) }));
jest.mock('@/lib/reading/voice-feedback-setting', () => ({
  loadVoiceFeedbackEnabled: jest.fn(() => Promise.resolve(false)),
  saveVoiceFeedbackEnabled: jest.fn(),
}));
jest.mock('@/lib/practice/session-state', () => ({ startPractice: jest.fn() }));
jest.mock('@/lib/api', () => ({
  api: {
    billingMe: jest.fn(),
    billingCheckout: jest.fn(),
    billingCancel: jest.fn(),
    billingRetry: jest.fn(),
    createPractice: jest.fn(),
    listPracticeGroups: jest.fn(),
  },
}));

const billingMe = api.billingMe as jest.Mock;
const billingCheckout = api.billingCheckout as jest.Mock;
const billingCancel = api.billingCancel as jest.Mock;
const billingRetry = api.billingRetry as jest.Mock;
const openAuth = WebBrowser.openAuthSessionAsync as jest.Mock;

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
};
const none = { ...active, status: 'none', pro: false, period_end: null, next_billing_at: null, card_company: null, card_last4: null };
const checkout = {
  checkout_url: 'https://dev.acttub.com/v2/billing/web/checkout/s',
  return_url: 'actingapp://billing-result',
  expires_at: '2026-10-23T02:00:00Z',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  Platform.OS = 'android';
});

test('Pro 안내(P0xJ9) — 비교 표와 가격, [Pro 시작하기]가 토스 카드 등록 창을 열고 결제되면 결제 완료로 간다', async () => {
  billingCheckout.mockResolvedValue(checkout);
  openAuth.mockResolvedValue({ type: 'success', url: 'actingapp://billing-result?status=done' });
  billingMe.mockResolvedValue(active);
  await render(<ProScreen />);

  expect(screen.getByText('ACTTUB Pro')).toBeOnTheScreen();
  expect(screen.getByText('하루 1번')).toBeOnTheScreen();
  expect(screen.getByText('PRO 배지')).toBeOnTheScreen();
  expect(screen.getByText('월 3,900원 · 매월 자동 결제 · 언제든 해지')).toBeOnTheScreen();

  await fireEvent.press(screen.getByText('Pro 시작하기'));

  await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/pro-done'));
  expect(billingCheckout).toHaveBeenCalledWith('subscribe');
  expect(openAuth).toHaveBeenCalledWith(checkout.checkout_url, 'actingapp://billing-result');
});

test('iOS 는 결제 창 전에 외부 결제 안내(hD5to)를 앱 화면으로 띄우고, 취소하면 열지 않는다', async () => {
  Platform.OS = 'ios';
  await render(<ProScreen />);
  await fireEvent.press(screen.getByText('Pro 시작하기'));

  expect(screen.getByText('이 앱은 App Store의 안전한 비공개 결제 시스템을 지원하지 않습니다.')).toBeOnTheScreen();
  await fireEvent.press(screen.getByText('취소'));
  expect(billingCheckout).not.toHaveBeenCalled();

  billingCheckout.mockResolvedValue(checkout);
  openAuth.mockResolvedValue({ type: 'success', url: 'actingapp://billing-result?status=failed' });
  billingMe.mockResolvedValue(none);
  await fireEvent.press(screen.getByText('Pro 시작하기'));
  await fireEvent.press(screen.getByText('계속'));
  await waitFor(() =>
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/pro-failed', params: { purpose: 'subscribe' } }),
  );
});

test('브라우저를 그냥 닫으면 안내에 그대로 남는다', async () => {
  billingCheckout.mockResolvedValue(checkout);
  openAuth.mockResolvedValue({ type: 'dismiss' });
  billingMe.mockResolvedValue(none);
  await render(<ProScreen />);
  await fireEvent.press(screen.getByText('Pro 시작하기'));
  await waitFor(() => expect(billingMe).toHaveBeenCalled());
  expect(mockRouter.replace).not.toHaveBeenCalled();
  expect(mockRouter.push).not.toHaveBeenCalled();
});

test('결제 창을 열지 못하면 알린다', async () => {
  billingCheckout.mockRejectedValue(Object.assign(new Error('x'), { status: 500, code: 'internal' }));
  await render(<ProScreen />);
  await fireEvent.press(screen.getByText('Pro 시작하기'));
  expect(await screen.findByText('결제 창을 열지 못했어요. 잠시 뒤 다시 시도해 주세요.')).toBeOnTheScreen();
});

test('결제 완료(kqeG6) — [계속하기]는 들어온 곳으로 돌아간다', async () => {
  await render(<ProDoneScreen />);
  expect(screen.getByText('이제 Pro예요!')).toBeOnTheScreen();
  await fireEvent.press(screen.getByText('계속하기'));
  expect(mockRouter.back).toHaveBeenCalled();
});

test('결제하지 못했어요(ETD1H) — 자동결제 실패면 [다시 시도]가 서버에 다시 결제를 맡긴다', async () => {
  billingMe.mockResolvedValue({ ...active, status: 'past_due', pro: false });
  billingRetry.mockResolvedValue(active);
  await render(<ProFailedScreen />);
  expect(screen.getByText('카드 한도나 정보를 확인해 주세요. 다시 시도해도 두 번 결제되지 않아요.')).toBeOnTheScreen();
  await fireEvent.press(screen.getByText('다시 시도'));
  await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/pro-done'));
  expect(billingRetry).toHaveBeenCalledTimes(1);
});

test('결과를 모를 때는 확인 중 문구와 [다시 확인하기] — 아직 모르면 그대로 둔다', async () => {
  mockParams = { purpose: 'subscribe', checking: '1' };
  billingMe.mockResolvedValue(none);
  await render(<ProFailedScreen />);
  expect(screen.getByText('결제 결과를 확인하고 있어요')).toBeOnTheScreen();
  await fireEvent.press(screen.getByText('다시 확인하기'));
  await waitFor(() => expect(billingMe).toHaveBeenCalled());
  expect(billingCheckout).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByText('나중에 할게요'));
  expect(mockRouter.back).toHaveBeenCalled();
});

test('첫 결제 실패의 [다시 시도]는 카드 등록 창을 다시 연다', async () => {
  mockParams = { purpose: 'subscribe' };
  billingMe.mockResolvedValue(none);
  billingCheckout.mockResolvedValue(checkout);
  openAuth.mockResolvedValue({ type: 'dismiss' });
  await render(<ProFailedScreen />);
  await fireEvent.press(screen.getByText('다시 시도'));
  await waitFor(() => expect(billingCheckout).toHaveBeenCalledWith('subscribe'));
});

test('구독 관리(GmTw6) — 다음 결제일·금액·카드, 자동결제 해지는 확인 뒤 기간 끝까지 Pro 로 바뀐다', async () => {
  billingMe.mockResolvedValue(active);
  billingCancel.mockResolvedValue({ ...active, status: 'canceled', next_billing_at: null });
  await render(<ProManageScreen />);

  expect(await screen.findByText('다음 결제 11월 23일 · 3,900원 · 신한카드 ····1234')).toBeOnTheScreen();
  expect(screen.getByText('Pro 이용 중')).toBeOnTheScreen();
  expect(screen.queryByText('구매 복원')).not.toBeOnTheScreen();

  await fireEvent.press(screen.getByText('자동결제 해지'));
  await fireEvent.press(await screen.findByText('해지하기'));

  expect(await screen.findByText('11월 23일까지 Pro · 자동결제 해지됨')).toBeOnTheScreen();
  expect(screen.queryByText('자동결제 해지')).not.toBeOnTheScreen();
});

test('구독 관리 — [결제 수단 바꾸기]는 change_card 창을 열고 바뀌면 알린다', async () => {
  billingMe.mockResolvedValue(active);
  billingCheckout.mockResolvedValue(checkout);
  openAuth.mockResolvedValue({ type: 'success', url: 'actingapp://billing-result?status=done' });
  await render(<ProManageScreen />);
  await fireEvent.press(await screen.findByText('결제 수단 바꾸기'));
  expect(await screen.findByText('결제 수단을 바꿨어요.')).toBeOnTheScreen();
  expect(billingCheckout).toHaveBeenCalledWith('change_card');
});

test('구독 관리 — 서버가 결제 기능을 닫았으면 나간다', async () => {
  billingMe.mockRejectedValue(Object.assign(new Error('closed'), { status: 404, code: 'billing_unavailable' }));
  await render(<ProManageScreen />);
  await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
});

test('설정 — 결제 기능이 열려 있으면 맨 위 「ACTTUB Pro」 줄이 Pro 안내로 간다', async () => {
  billingMe.mockResolvedValue(none);
  await render(<SettingsScreen />);
  await fireEvent.press(await screen.findByText('무료 이용 중 · Pro 알아보기'));
  expect(mockRouter.push).toHaveBeenCalledWith('/pro');
});

test('설정 — 구독 중이면 구독 관리로, 결제 기능이 닫혀 있으면 줄을 숨긴다', async () => {
  billingMe.mockResolvedValueOnce(active);
  await render(<SettingsScreen />);
  await fireEvent.press(await screen.findByText('Pro 이용 중'));
  expect(mockRouter.push).toHaveBeenCalledWith('/pro-manage');
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
  await fireEvent.press(screen.getByRole('button', { name: '고민 상담' }));
  expect(await screen.findByText('오늘 무료 코칭을 다 썼어요')).toBeOnTheScreen();
  await fireEvent.press(screen.getByText('Pro 알아보기'));
  expect(mockRouter.push).toHaveBeenCalledWith('/pro');
});

test('앱 스킴으로 열린 billing-result 는 바로 닫힌다', async () => {
  await render(<BillingResultScreen />);
  expect(mockRouter.back).toHaveBeenCalled();
});
