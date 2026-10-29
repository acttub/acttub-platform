import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as WebBrowser from 'expo-web-browser';
import { Linking, Platform } from 'react-native';

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
const mockRc = {
  isConfigured: jest.fn(() => Promise.resolve(false)),
  configure: jest.fn(),
  getAppUserID: jest.fn(() => Promise.resolve('11111111-1111-4111-8111-111111111111')),
  logIn: jest.fn(() => Promise.resolve({ customerInfo: {}, created: false })),
  logOut: jest.fn(() => Promise.resolve({})),
  isAnonymous: jest.fn(() => Promise.resolve(false)),
  getOfferings: jest.fn(),
  purchasePackage: jest.fn(),
  restorePurchases: jest.fn(() => Promise.resolve({})),
  getCustomerInfo: jest.fn(),
};
jest.mock('react-native-purchases', () => ({
  __esModule: true,
  default: new Proxy({}, { get: (_t, name: string) => (...a: unknown[]) => (mockRc as Record<string, jest.Mock>)[name](...a) }),
}));
jest.mock('expo-application', () => ({ applicationId: 'com.acttub.app' }));
jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn(), openBrowserAsync: jest.fn() }));
jest.mock('@/lib/analytics', () => ({ logEvent: jest.fn(() => Promise.resolve()) }));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ signOut: jest.fn(), user: { id: '11111111-1111-4111-8111-111111111111' } }) }));
jest.mock('@/lib/practice/session-state', () => ({ startPractice: jest.fn() }));
jest.mock('@/lib/api', () => ({
  api: {
    billingMe: jest.fn(),
    syncStorePurchases: jest.fn(),
    createPractice: jest.fn(),
    listPracticeGroups: jest.fn(),
  },
}));

const billingMe = api.billingMe as jest.Mock;
const syncStorePurchases = api.syncStorePurchases as jest.Mock;
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
  mockRc.isConfigured.mockResolvedValue(false);
  process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY = 'appl_test';
  process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY = 'goog_test';
  mockParams = {};
  Platform.OS = 'android';
});

test('Pro 안내 — 앱 결제가 닫혀 있으면 제목·혜택 세 줄만 있고 요금제·구매 버튼·웹 결제 링크는 없다', async () => {
  billingMe.mockResolvedValue({ ...none, app_enabled: false });
  await render(<ProScreen />);

  expect(screen.getByText('Pro로 제한 없이 연습해요')).toBeOnTheScreen();
  expect(screen.getByText('코칭·대본 보관 제한 없이')).toBeOnTheScreen();
  expect(screen.getByText('상위 AI 모델로 더 자세한 코칭')).toBeOnTheScreen();
  expect(screen.getByText('발음 보고서 · 고품질 목소리 · 광고 없음')).toBeOnTheScreen();
  await waitFor(() => expect(billingMe).toHaveBeenCalled());
  expect(screen.queryByText('월 구독')).not.toBeOnTheScreen();
  expect(screen.queryByText('Pro 시작하기')).not.toBeOnTheScreen();
  expect(screen.queryByText(/acttub\.com\/pricing/)).not.toBeOnTheScreen();
  expect(mockRc.configure).not.toHaveBeenCalled();
});

const pkg = (identifier: string, productId: string, priceString: string) => ({
  identifier,
  product: { identifier: productId, priceString },
});
const monthlyPkg = pkg('$rc_monthly', 'acttub_pro_monthly', '₩3,900');
const annualPkg = pkg('$rc_annual', 'acttub_pro_yearly', '₩32,500');
const offerings = (current: Record<string, unknown> | null) => ({ current, all: {} });

test('스토어 구독(Android) — 요금제·현지화 가격·자동 갱신·해지 방법·약관이 보이고, 우리 user id 로 RevenueCat 을 열어 월 패키지를 산 뒤 서버 동기화로 완료 화면에 간다', async () => {
  billingMe.mockResolvedValue({ ...none, app_enabled: true });
  mockRc.getOfferings.mockResolvedValue(offerings({ monthly: monthlyPkg, annual: null, availablePackages: [monthlyPkg] }));
  let finishPurchase: () => void = () => undefined;
  mockRc.purchasePackage.mockImplementation(() => new Promise((resolve) => (finishPurchase = () => resolve({ customerInfo: {} }))));
  syncStorePurchases.mockResolvedValue({ ...active, provider: 'google' });
  await render(<ProScreen />);

  expect(await screen.findByText('₩3,900')).toBeOnTheScreen();
  expect(mockRc.configure).toHaveBeenCalledWith({ apiKey: 'goog_test', appUserID: USER });
  expect(screen.getByText('월 구독')).toBeOnTheScreen();
  expect(screen.getByText('1개월')).toBeOnTheScreen();
  expect(screen.getByText('매달 자동 갱신')).toBeOnTheScreen();
  expect(screen.getByText('해지는 Play 스토어 > 결제 및 정기 결제에서 언제든 할 수 있어요.')).toBeOnTheScreen();
  expect(screen.getByText('이용약관')).toBeOnTheScreen();
  expect(screen.getByText('개인정보 처리방침')).toBeOnTheScreen();
  expect(screen.queryByText(/acttub\.com\/pricing/)).not.toBeOnTheScreen();

  await fireEvent.press(screen.getByText('Pro 시작하기'));
  expect(await screen.findByText('결제창을 여는 중이에요')).toBeOnTheScreen();
  expect(mockRc.purchasePackage).toHaveBeenCalledWith(monthlyPkg);
  await act(async () => finishPurchase());
  await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/pro-done'));
  expect(syncStorePurchases).toHaveBeenCalledTimes(1);
});

test('스토어 구독(iOS) — 결제가 끝나도 서버가 Pro 라고 할 때만 완료 화면에 가고, 서버가 거절하면 안내만 한다', async () => {
  Platform.OS = 'ios';
  billingMe.mockResolvedValue({ ...none, app_enabled: true });
  mockRc.getOfferings.mockResolvedValue(offerings({ monthly: monthlyPkg, annual: annualPkg }));
  mockRc.purchasePackage.mockResolvedValue({ customerInfo: {} });
  syncStorePurchases.mockRejectedValue(Object.assign(new Error('taken'), { status: 409, code: 'already_subscribed' }));
  await render(<ProScreen />);
  expect(await screen.findByText('₩3,900')).toBeOnTheScreen();
  expect(mockRc.configure).toHaveBeenCalledWith({ apiKey: 'appl_test', appUserID: USER });
  expect(screen.getByText('해지는 설정 > Apple 계정 > 구독에서 언제든 할 수 있어요.')).toBeOnTheScreen();

  await fireEvent.press(screen.getByText('Pro 시작하기'));
  expect(await screen.findByText('이미 Pro를 이용 중이에요.')).toBeOnTheScreen();
  expect(mockRouter.replace).not.toHaveBeenCalled();
});

test('스토어 구독 — 사용자가 결제를 취소하면 오류 없이 버튼이 돌아오고 서버를 부르지 않는다. 결제 대기는 안내한다', async () => {
  billingMe.mockResolvedValue({ ...none, app_enabled: true });
  mockRc.getOfferings.mockResolvedValue(offerings({ monthly: monthlyPkg }));
  mockRc.purchasePackage.mockRejectedValueOnce(Object.assign(new Error('cancel'), { code: '1', userCancelled: true }));
  await render(<ProScreen />);
  await fireEvent.press(await screen.findByText('Pro 시작하기'));
  expect(await screen.findByText('Pro 시작하기')).toBeOnTheScreen();
  expect(screen.queryByText(/스토어에 연결하지 못했어요/)).not.toBeOnTheScreen();
  expect(syncStorePurchases).not.toHaveBeenCalled();

  mockRc.purchasePackage.mockRejectedValueOnce(Object.assign(new Error('pending'), { code: '20', userCancelled: false }));
  await fireEvent.press(screen.getByText('Pro 시작하기'));
  expect(await screen.findByText(/결제가 아직 끝나지 않았어요/)).toBeOnTheScreen();
  expect(syncStorePurchases).not.toHaveBeenCalled();
});

test('구매 복원 — RevenueCat 복원 뒤 서버 동기화로 확인하고, 서버가 Pro 가 아니라고 하면 없다고 안내한다', async () => {
  billingMe.mockResolvedValue({ ...none, app_enabled: true });
  mockRc.getOfferings.mockResolvedValue(offerings({ monthly: monthlyPkg }));
  syncStorePurchases.mockResolvedValueOnce({ ...none, app_enabled: true });
  await render(<ProScreen />);
  await fireEvent.press(await screen.findByText('구매 복원'));
  expect(await screen.findByText('복원할 구독이 없어요')).toBeOnTheScreen();
  expect(mockRc.restorePurchases).toHaveBeenCalledTimes(1);

  syncStorePurchases.mockResolvedValue({ ...active, provider: 'google' });
  await fireEvent.press(screen.getByText('구매 복원'));
  await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/pro-done'));
  expect(mockRc.restorePurchases).toHaveBeenCalledTimes(2);
});

test('RevenueCat 키가 없는 빌드는 스토어에 연결하지 않고 구매 버튼을 누를 수 없다', async () => {
  process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY = '';
  billingMe.mockResolvedValue({ ...none, app_enabled: true });
  await render(<ProScreen />);
  expect(await screen.findByText('Pro 시작하기')).toBeOnTheScreen();
  expect(mockRc.configure).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByText('Pro 시작하기'));
  expect(mockRc.purchasePackage).not.toHaveBeenCalled();
});

test('이미 Pro(웹 결제 등)이면 요금제·구매 버튼 대신 상태 상자만 보이고 스토어에 연결하지 않는다', async () => {
  billingMe.mockResolvedValue({ ...active, app_enabled: true });
  await render(<ProScreen />);
  expect(await screen.findByText('이미 Pro를 이용 중이에요')).toBeOnTheScreen();
  expect(screen.queryByText('Pro 시작하기')).not.toBeOnTheScreen();
  expect(screen.queryByText('월 구독')).not.toBeOnTheScreen();
  expect(screen.queryByText('이용약관')).not.toBeOnTheScreen();
  expect(screen.queryByText('구매 복원')).not.toBeOnTheScreen();
  expect(mockRc.configure).not.toHaveBeenCalled();
});

test('구독 관리 — 스토어 구독이면 「스토어에서 구독 관리」가 스토어 구독 관리 화면을 연다(Android 는 월·연 어느 쪽이든 이 앱의 정기 결제 목록)', async () => {
  billingMe.mockResolvedValue({ ...active, provider: 'google' });
  const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  await render(<ProManageScreen />);
  await fireEvent.press(await screen.findByText('스토어에서 구독 관리'));
  expect(openURL).toHaveBeenCalledWith('https://play.google.com/store/account/subscriptions?package=com.acttub.app');
  Platform.OS = 'ios';
  await fireEvent.press(screen.getByText('스토어에서 구독 관리'));
  expect(openURL).toHaveBeenLastCalledWith('https://apps.apple.com/account/subscriptions');
  openURL.mockRestore();
});

test('연 구독(30% 할인) — 연을 고르면 연 패키지·연 가격·1년 자동 갱신 안내가 보이고 연 패키지($rc_annual)로 결제한다', async () => {
  billingMe.mockResolvedValue({ ...none, app_enabled: true });
  mockRc.getOfferings.mockResolvedValue(offerings({ monthly: monthlyPkg, annual: annualPkg }));
  mockRc.purchasePackage.mockResolvedValue({ customerInfo: {} });
  syncStorePurchases.mockResolvedValue({ ...active, provider: 'google' });
  await render(<ProScreen />);
  expect(await screen.findByText('₩32,500')).toBeOnTheScreen();
  expect(screen.getByText('30% 할인')).toBeOnTheScreen();
  expect(screen.getByText('1년')).toBeOnTheScreen();
  expect(screen.getByText('월 2,708원꼴 · 매년 자동 갱신')).toBeOnTheScreen();

  await fireEvent.press(screen.getByText('연 구독'));
  expect(screen.getByRole('radio', { name: /연 구독/ })).toBeSelected();

  await fireEvent.press(screen.getByText('Pro 시작하기'));
  await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/pro-done'));
  expect(mockRc.purchasePackage).toHaveBeenCalledWith(annualPkg);
});

test('연 패키지가 오퍼링에 아직 없으면 연 구독은 고를 수 없고 월 구독은 그대로 살 수 있다', async () => {
  billingMe.mockResolvedValue({ ...none, app_enabled: true });
  mockRc.getOfferings.mockResolvedValue(offerings({ monthly: monthlyPkg, annual: null, availablePackages: [monthlyPkg] }));
  mockRc.purchasePackage.mockResolvedValue({ customerInfo: {} });
  syncStorePurchases.mockResolvedValue({ ...active, provider: 'google' });
  await render(<ProScreen />);
  expect(await screen.findByText('₩3,900')).toBeOnTheScreen();
  await fireEvent.press(screen.getByText('연 구독'));
  expect(screen.getByRole('radio', { name: /월 구독/ })).toBeSelected();
  expect(screen.getByRole('radio', { name: /연 구독/ })).toBeDisabled();
  await fireEvent.press(screen.getByText('Pro 시작하기'));
  await waitFor(() => expect(mockRc.purchasePackage).toHaveBeenCalledWith(monthlyPkg));
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

test('코칭 시작이 무료 한도(free_daily_coaching_limit)에 걸리면 「오늘 무료 코칭 3회를 다 썼어요」 확인창이 뜨고 [Pro 알아보기]는 코칭 한도 안내로 간다', async () => {
  (api.createPractice as jest.Mock).mockRejectedValue(
    Object.assign(new Error('limit'), { status: 429, code: 'free_daily_coaching_limit' }),
  );
  await render(<TalkScreen />);
  await fireEvent.press(screen.getByText('고민 상담'));
  await fireEvent.press(screen.getByText('다음'));
  expect(await screen.findByText('오늘 무료 코칭 3회를 다 썼어요')).toBeOnTheScreen();
  expect(screen.getByText('내일 다시 무료로 받을 수 있어요. Pro는 제한 없이 코칭해요.')).toBeOnTheScreen();
  await fireEvent.press(screen.getByText('Pro 알아보기'));
  expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/pro', params: { from: 'coaching' } });
});

test('창립 멤버(SOMA-861) — 결제 화면 맨 위에 「창립 멤버 n자리 남음」 한 줄이 보이고, 0이면 숨는다', async () => {
  billingMe.mockResolvedValue({ ...none, app_enabled: false, founding_remaining: 63 });
  await render(<ProScreen />);
  expect(await screen.findByText('창립 멤버 63자리 남음')).toBeOnTheScreen();
});

test('창립 멤버(SOMA-861) — 남은 자리가 0이면 줄이 없다', async () => {
  billingMe.mockResolvedValue({ ...none, app_enabled: false, founding_remaining: 0 });
  await render(<ProScreen />);
  await waitFor(() => expect(billingMe).toHaveBeenCalled());
  expect(screen.getByText('Pro로 제한 없이 연습해요')).toBeOnTheScreen();
  expect(screen.queryByText(/창립 멤버/)).not.toBeOnTheScreen();
});

test('Pro 안내 — 요금제는 월 구독이 먼저이고 기본으로 골라져 있어 바로 월 패키지로 결제한다', async () => {
  billingMe.mockResolvedValue({ ...none, app_enabled: true });
  mockRc.getOfferings.mockResolvedValue(offerings({ monthly: monthlyPkg, annual: annualPkg }));
  mockRc.purchasePackage.mockResolvedValue({ customerInfo: {} });
  syncStorePurchases.mockResolvedValue({ ...active, provider: 'google' });
  await render(<ProScreen />);
  await screen.findByText('₩3,900');
  const radios = screen.getAllByRole('radio');
  expect(radios.map((r) => r.props.accessibilityState)).toEqual([
    { selected: true, disabled: false },
    { selected: false, disabled: false },
  ]);
  expect(screen.getByRole('radio', { name: /월 구독/ })).toBeSelected();
  await fireEvent.press(screen.getByText('Pro 시작하기'));
  await waitFor(() => expect(mockRc.purchasePackage).toHaveBeenCalledWith(monthlyPkg));
});

test('Pro 안내 — 코칭 한도에서 오면 위 상자에 오늘 한도를 말하고 코칭 제목·혜택을 보인다', async () => {
  mockParams = { from: 'coaching' };
  billingMe.mockResolvedValue({ ...none, app_enabled: false });
  await render(<ProScreen />);
  expect(screen.getByText('오늘 무료 코칭 3회를 다 썼어요')).toBeOnTheScreen();
  expect(screen.getByText('내일 다시 무료로 받을 수 있어요.')).toBeOnTheScreen();
  expect(screen.getByText('코칭을 제한 없이 받아요')).toBeOnTheScreen();
  expect(screen.getByText('코칭 횟수 제한 없이')).toBeOnTheScreen();
  expect(screen.getByText('반복되는 버릇을 기억해 짚어 줘요')).toBeOnTheScreen();
  expect(screen.queryByText('Pro로 제한 없이 연습해요')).not.toBeOnTheScreen();
  await waitFor(() => expect(billingMe).toHaveBeenCalled());
});

test('Pro 안내 — 대본 한도·발음 보고서에서 오면 그 제목을 보이고, 모르는 값은 기본 안내다', async () => {
  billingMe.mockResolvedValue({ ...none, app_enabled: false });
  mockParams = { from: 'script' };
  const { unmount } = await render(<ProScreen />);
  expect(screen.getByText('무료는 대본 3개까지 보관해요')).toBeOnTheScreen();
  expect(screen.getByText('대본을 제한 없이 보관해요')).toBeOnTheScreen();
  expect(screen.getByText('리딩 대본 보관 제한 없이')).toBeOnTheScreen();
  await unmount();

  mockParams = { from: 'pron' };
  const second = await render(<ProScreen />);
  expect(screen.getByText('발음 보고서를 받아 보세요')).toBeOnTheScreen();
  expect(screen.getByText('리딩이 끝나면 발음 보고서')).toBeOnTheScreen();
  await second.unmount();

  mockParams = { from: 'nope' };
  await render(<ProScreen />);
  expect(screen.getByText('Pro로 제한 없이 연습해요')).toBeOnTheScreen();
  await waitFor(() => expect(billingMe).toHaveBeenCalledTimes(3));
});

test('Pro 안내 — 가격을 받는 동안은 가격 자리가 뼈대이고 [Pro 시작하기]는 눌리지 않는다', async () => {
  billingMe.mockResolvedValue({ ...none, app_enabled: true });
  mockRc.getOfferings.mockReturnValue(new Promise(() => undefined));
  await render(<ProScreen />);
  await waitFor(() => expect(mockRc.getOfferings).toHaveBeenCalled());
  expect(screen.getByText('매달 자동 갱신')).toBeOnTheScreen();
  expect(screen.getByText('매년 자동 갱신')).toBeOnTheScreen();
  expect(screen.queryByText('1개월')).not.toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Pro 시작하기' })).toBeDisabled();
});

test('Pro 안내 — 스토어에서 가격을 못 받으면 요금제 대신 「가격을 불러오지 못했어요」 상자이고 버튼은 눌리지 않는다', async () => {
  billingMe.mockResolvedValue({ ...none, app_enabled: true });
  mockRc.getOfferings.mockRejectedValue(new Error('offline'));
  await render(<ProScreen />);
  expect(await screen.findByText('가격을 불러오지 못했어요')).toBeOnTheScreen();
  expect(screen.queryByText('월 구독')).not.toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Pro 시작하기' })).toBeDisabled();
  expect(screen.getByText('구매 복원')).toBeOnTheScreen();
});

test('Pro 안내 — 결제가 실패하면 버튼 바로 위에 한 줄로 알리고 다시 누를 수 있다', async () => {
  billingMe.mockResolvedValue({ ...none, app_enabled: true });
  mockRc.getOfferings.mockResolvedValue(offerings({ monthly: monthlyPkg }));
  mockRc.purchasePackage.mockRejectedValueOnce(Object.assign(new Error('store'), { code: '2', userCancelled: false }));
  await render(<ProScreen />);
  await fireEvent.press(await screen.findByText('Pro 시작하기'));
  expect(await screen.findByText('스토어에 연결하지 못했어요. 잠시 뒤 다시 시도해 주세요.')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Pro 시작하기' })).toBeEnabled();
});

test('Pro 안내 — 이용약관·개인정보 처리방침은 웹 문서를 열고, 뒤로 꺾쇠는 들어온 곳으로 간다', async () => {
  billingMe.mockResolvedValue({ ...none, app_enabled: true });
  mockRc.getOfferings.mockResolvedValue(offerings({ monthly: monthlyPkg }));
  await render(<ProScreen />);
  await fireEvent.press(await screen.findByText('개인정보 처리방침'));
  expect(WebBrowser.openBrowserAsync).toHaveBeenLastCalledWith('https://acttub.com/privacy');
  await fireEvent.press(screen.getByText('이용약관'));
  expect(WebBrowser.openBrowserAsync).toHaveBeenLastCalledWith('https://acttub.com/terms');
  await fireEvent.press(screen.getByLabelText('뒤로'));
  expect(mockRouter.back).toHaveBeenCalled();
});
