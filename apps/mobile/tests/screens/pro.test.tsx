import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
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
    createPractice: jest.fn(),
    listPracticeGroups: jest.fn(),
  },
}));

const billingMe = api.billingMe as jest.Mock;

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
  mockParams = {};
  Platform.OS = 'android';
});

test('Pro 안내(P0xJ9) — 비교 표와 가격만 있고 구매 버튼과 웹 결제 링크는 없다(스토어 결제 2단계 자리)', async () => {
  billingMe.mockResolvedValue({ ...none, app_enabled: true });
  await render(<ProScreen />);

  expect(screen.getByText('ACTTUB Pro')).toBeOnTheScreen();
  expect(screen.getByText('하루 1번')).toBeOnTheScreen();
  expect(screen.getByText('월 3,900원 · 매월 자동 결제 · 언제든 해지')).toBeOnTheScreen();
  expect(screen.queryByText('Pro 시작하기')).not.toBeOnTheScreen();
  expect(screen.queryByText(/acttub\.com\/pricing/)).not.toBeOnTheScreen();
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
