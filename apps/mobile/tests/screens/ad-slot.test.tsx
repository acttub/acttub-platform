import { Linking } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { api } from '@/lib/api';
import { setFirstTimeState } from '@/lib/practice/first-time';

const { AdSlot, resetAdSlotMemoryForTest, ageAdSlotFailuresForTest, NETWORK_FAILED_HOLD_MS } = jest.requireActual('@/components/ad-slot') as typeof import('@/components/ad-slot');

// AdMob 초기화가 끝났는지(lib/ads-native isAdMobReady). 기본은 끝난 상태로 두고, 초기화 전을 보는 테스트만 false 로 바꾼다.
let mockAdMobReady = true;
const mockReadyListeners = new Set<() => void>();
function setAdMobReady(next: boolean) {
  mockAdMobReady = next;
  mockReadyListeners.forEach((listener) => listener());
}

// 화면이 보이는지(useIsFocused). 기본은 보이는 상태, 숨은 화면을 보는 테스트만 false 로 바꾼다.
let mockFocused = true;
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => mockFocused }));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('expo-image', () => {
  const { View } = jest.requireActual('react-native');
  return { Image: (props: Record<string, unknown>) => <View testID="ad-image" {...props} /> };
});
jest.mock('@/lib/analytics', () => ({ logEvent: jest.fn() }));
jest.mock('@/lib/ads-native', () => ({
  isAdMobReady: () => mockAdMobReady,
  subscribeAdMobReady: (listener: () => void) => {
    mockReadyListeners.add(listener);
    return () => mockReadyListeners.delete(listener);
  },
  loadBannerModule: () => {
    const { View } = jest.requireActual('react-native');
    return {
      BannerAd: (props: Record<string, unknown>) => <View testID="admob-banner" {...props} />,
      BannerAdSize: { BANNER: 'BANNER', LARGE_BANNER: 'LARGE_BANNER', MEDIUM_RECTANGLE: 'MEDIUM_RECTANGLE', ANCHORED_ADAPTIVE_BANNER: 'ANCHORED_ADAPTIVE_BANNER', INLINE_ADAPTIVE_BANNER: 'INLINE_ADAPTIVE_BANNER' },
    };
  },
}));
let mockBirthDate: string | null = null;
jest.mock('@/lib/auth', () => ({
  useAuth: () => ({ profile: { me: mockBirthDate ? { profile: { birth_date: mockBirthDate } } : null } }),
}));
jest.mock('@/lib/api', () => ({
  api: { getAdSlot: jest.fn(), recordAdEvent: jest.fn(() => Promise.resolve()) },
}));

const getAdSlot = api.getAdSlot as jest.Mock;
const recordAdEvent = api.recordAdEvent as jest.Mock;

const creative = (over: Record<string, unknown>) => ({
  id: 'ad-1', image_url: null, headline: null, body: null, app_path: null, advertiser_name: null, link_url: null, ...over,
});

let openURL: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  setFirstTimeState('practiced');
  mockBirthDate = null;
  mockAdMobReady = true;
  mockFocused = true;
  mockReadyListeners.clear();
  resetAdSlotMemoryForTest();
});

test('첫 사용자면 서버에 묻지 않고 아무것도 그리지 않는다', async () => {
  setFirstTimeState('first');
  const view = await render(<AdSlot slot="settings_top" />);
  expect(view.toJSON()).toBeNull();
  expect(getAdSlot).not.toHaveBeenCalled();
});

test('받기 전에는 자리를 잡고, NONE 이면 비운다', async () => {
  let resolve: (value: unknown) => void = () => undefined;
  getAdSlot.mockReturnValue(new Promise((r) => { resolve = r; }));
  const view = await render(<AdSlot slot="report_top" />);
  expect(view.toJSON()).not.toBeNull();
  await act(async () => resolve({ kind: 'NONE', slot: 'report_top', size: 'BANNER', width: 320, height: 50, ad: null }));
  await waitFor(() => expect(view.toJSON()).toBeNull());
});

test('NETWORK 배너 칸은 규격 크기 AdMob 배너를 좌우 끝까지 깐 띠 가운데에 그린다(테스트 단위)', async () => {
  getAdSlot.mockResolvedValue({ kind: 'NETWORK', slot: 'home_top', size: 'BANNER', width: 320, height: 50, ad: null });
  await render(<AdSlot slot="home_top" />);
  const banner = await screen.findByTestId('admob-banner');
  // 적응형은 안 맞는 광고를 검은 띠로 채우거나 눌렀다(11/3 폰 QA) — 규격 크기로 받는다.
  expect(banner.props.size).toBe('BANNER');
  expect(banner.props.maxHeight).toBeUndefined();
  expect(banner.props.unitId).toMatch(/^ca-app-pub-3940256099942544\//);
});

test('300×250 칸은 좌우로 늘리지 않고 고정 규격 AdMob 배너 그대로다', async () => {
  getAdSlot.mockResolvedValue({ kind: 'NETWORK', slot: 'analyzing_wait', size: 'MEDIUM_RECTANGLE', width: 300, height: 250, ad: null });
  await render(<AdSlot slot="analyzing_wait" />);
  const banner = await screen.findByTestId('admob-banner');
  expect(banner.props.size).toBe('MEDIUM_RECTANGLE');
  expect(banner.props.maxHeight).toBeUndefined();
});

test('anchored 도 AdMob 은 규격 크기다 — 적응형은 안 맞는 광고 양옆·위아래를 검게 채웠다', async () => {
  getAdSlot.mockResolvedValue({ kind: 'NETWORK', slot: 'community_list_top', size: 'BANNER', width: 320, height: 50, ad: null });
  await render(<AdSlot slot="community_list_top" anchored />);
  const banner = await screen.findByTestId('admob-banner');
  expect(banner.props.size).toBe('BANNER');
});

test('직접 광고는 「광고」 라벨과 함께 그리고, 이미지가 뜨면 노출·누르면 클릭을 남기고 광고주 링크를 앱 밖으로 연다', async () => {
  getAdSlot.mockResolvedValue({
    kind: 'DIRECT', slot: 'archive_top', size: 'LARGE_BANNER', width: 320, height: 100,
    ad: creative({ image_url: 'https://cdn/a.png', advertiser_name: '한빛연기학원', link_url: 'https://example.com/hanbit' }),
  });
  await render(<AdSlot slot="archive_top" />);
  const image = await screen.findByTestId('ad-image');
  expect(screen.getByText('광고')).toBeTruthy();
  await act(async () => image.props.onLoad());
  expect(recordAdEvent).toHaveBeenCalledWith('ad-1', 'archive_top', 'impression');
  await fireEvent.press(screen.getByLabelText('광고 한빛연기학원'));
  expect(recordAdEvent).toHaveBeenCalledWith('ad-1', 'archive_top', 'click');
  expect(openURL).toHaveBeenCalledWith('https://example.com/hanbit');
  expect(mockPush).not.toHaveBeenCalled();
});

test('직접 광고인데 링크가 http(s)가 아니면 그리지 않는다', async () => {
  getAdSlot.mockResolvedValue({
    kind: 'DIRECT', slot: 'archive_top', size: 'LARGE_BANNER', width: 320, height: 100,
    ad: creative({ image_url: 'https://cdn/a.png', link_url: 'javascript:alert(1)' }),
  });
  const view = await render(<AdSlot slot="archive_top" />);
  await waitFor(() => expect(view.toJSON()).toBeNull());
});

test('우리 앱 광고는 문구로 그리고 앱 안 경로로 간다', async () => {
  getAdSlot.mockResolvedValue({
    kind: 'HOUSE', slot: 'profile_top', size: 'BANNER', width: 320, height: 50,
    ad: creative({ id: 'h-1', headline: '이번 주 챌린지 대사가 나왔어요', app_path: '/(tabs)/challenges' }),
  });
  await render(<AdSlot slot="profile_top" />);
  await fireEvent.press(await screen.findByText('이번 주 챌린지 대사가 나왔어요'));
  expect(mockPush).toHaveBeenCalledWith('/(tabs)/challenges');
});

test('서버 오류(게스트 403 등)면 칸을 비운다', async () => {
  getAdSlot.mockRejectedValue(Object.assign(new Error('member_only'), { status: 403 }));
  const view = await render(<AdSlot slot="line_search_top" />);
  await waitFor(() => expect(view.toJSON()).toBeNull());
});

// 11/2 폰 QA — 채워지지 않은 AdMob 배너가 빈 상자로 남아 화면 위에 빈 공간이 생겼다.
test('NETWORK 배너가 정해진 시간 안에 안 채워지면 칸을 접는다', async () => {
  getAdSlot.mockResolvedValue({ kind: 'NETWORK', slot: 'community_list_top', size: 'LARGE_BANNER', width: 320, height: 100, ad: null });
  const view = await render(<AdSlot slot="community_list_top" fillTimeoutMs={30} />);
  await screen.findByTestId('admob-banner');
  await waitFor(() => expect(view.toJSON()).toBeNull());
});

// 11/3 사용자 「admob 이 안 올 때 pro 홍보 배너로 채우자」(SOMA-1030)
const proFallback = creative({ id: 'pro-1', image_url: 'https://cdn/pro.png', app_path: '/pro', advertiser_name: 'Pro 홍보' });

test('AdMob 이 실패하면 칸을 접지 않고 fallback 우리 앱 광고(Pro 홍보)로 채우고, 누르면 그 경로로 간다', async () => {
  getAdSlot.mockResolvedValue({ kind: 'NETWORK', slot: 'home_top', size: 'BANNER', width: 320, height: 50, ad: null, fallback: proFallback });
  await render(<AdSlot slot="home_top" />);
  const banner = await screen.findByTestId('admob-banner');
  await act(async () => banner.props.onAdFailedToLoad());
  const image = await screen.findByTestId('ad-image');
  expect(screen.queryByTestId('admob-banner')).toBeNull();
  await act(async () => image.props.onLoad());
  expect(recordAdEvent).toHaveBeenCalledWith('pro-1', 'home_top', 'impression');
  fireEvent.press(screen.getByLabelText('광고 Pro 홍보'));
  expect(mockPush).toHaveBeenCalledWith('/pro');
});

test('AdMob 이 시간 안에 안 채워져도 fallback 으로 채우고, fallback 이미지가 깨지면 그때 접는다', async () => {
  getAdSlot.mockResolvedValue({ kind: 'NETWORK', slot: 'community_list_top', size: 'LARGE_BANNER', width: 320, height: 100, ad: null, fallback: proFallback });
  const view = await render(<AdSlot slot="community_list_top" fillTimeoutMs={30} />);
  await screen.findByTestId('admob-banner');
  const image = await screen.findByTestId('ad-image');
  await act(async () => image.props.onError());
  await waitFor(() => expect(view.toJSON()).toBeNull());
});

test('NETWORK 배너가 채워지면 시간이 지나도 그대로 둔다', async () => {
  getAdSlot.mockResolvedValue({ kind: 'NETWORK', slot: 'community_list_top', size: 'LARGE_BANNER', width: 320, height: 100, ad: null });
  await render(<AdSlot slot="community_list_top" fillTimeoutMs={30} />);
  const banner = await screen.findByTestId('admob-banner');
  await act(async () => banner.props.onAdLoaded());
  await act(async () => new Promise((r) => setTimeout(r, 80)));
  expect(screen.getByTestId('admob-banner')).toBeOnTheScreen();
});

// 11/3 폰 QA: 앱을 켜자마자 홈 광고 칸이 자리 → 접힘 → 광고가 다시 들어오며 아래 카드를 밀었다.
test('AdMob 초기화가 끝나기 전에는 같은 높이 띠만 깔고 배너를 붙이지 않다가, 끝나면 그 자리에 붙인다', async () => {
  mockAdMobReady = false;
  getAdSlot.mockResolvedValue({ kind: 'NETWORK', slot: 'home_top', size: 'BANNER', width: 320, height: 50, ad: null });
  const view = await render(<AdSlot slot="home_top" />);
  await waitFor(() => expect(getAdSlot).toHaveBeenCalled());
  await act(async () => undefined);
  expect(screen.queryByTestId('admob-banner')).toBeNull();
  expect(view.toJSON()).not.toBeNull();
  await act(async () => setAdMobReady(true));
  expect(await screen.findByTestId('admob-banner')).toBeTruthy();
});

test('AdMob 이 못 채워 접힌 칸은 잠시 동안 다시 그려져도 열지 않는다 — 다시 생기며 카드를 밀지 않게', async () => {
  getAdSlot.mockResolvedValue({ kind: 'NETWORK', slot: 'home_top', size: 'BANNER', width: 320, height: 50, ad: null });
  const first = await render(<AdSlot slot="home_top" />);
  const banner = await screen.findByTestId('admob-banner');
  await act(async () => banner.props.onAdFailedToLoad({ code: 'no-fill' }));
  await waitFor(() => expect(first.toJSON()).toBeNull());
  await first.unmount();
  getAdSlot.mockClear();
  const again = await render(<AdSlot slot="home_top" />);
  await act(async () => undefined);
  expect(again.toJSON()).toBeNull();
  expect(getAdSlot).not.toHaveBeenCalled();
});

test('접힌 지 1분이 지나면 다시 그릴 때 처음부터 자리를 잡고 연다', async () => {
  getAdSlot.mockResolvedValue({ kind: 'NETWORK', slot: 'profile_top', size: 'BANNER', width: 320, height: 50, ad: null });
  const first = await render(<AdSlot slot="profile_top" />);
  const banner = await screen.findByTestId('admob-banner');
  await act(async () => banner.props.onAdFailedToLoad());
  await waitFor(() => expect(first.toJSON()).toBeNull());
  await first.unmount();
  ageAdSlotFailuresForTest(NETWORK_FAILED_HOLD_MS + 1);
  await render(<AdSlot slot="profile_top" />);
  expect(await screen.findByTestId('admob-banner')).toBeTruthy();
});

test('reserve={false} 면 받기 전에 자리를 잡지 않는다 — 지난번에 비었던 칸이 자리를 잡았다가 접히며 아래를 올리지 않게', async () => {
  let resolve: (value: unknown) => void = () => undefined;
  getAdSlot.mockReturnValue(new Promise((r) => { resolve = r; }));
  const view = await render(<AdSlot slot="settings_top" reserve={false} />);
  expect(view.toJSON()).toBeNull();
  await act(async () => resolve({ kind: 'NONE', slot: 'settings_top', size: 'BANNER', width: 320, height: 50, ad: null }));
  expect(view.toJSON()).toBeNull();
});

test('보이는지가 정해지면 onShownChange 로 알린다 — 받는 중에는 알리지 않는다', async () => {
  const shown = jest.fn();
  let resolve: (value: unknown) => void = () => undefined;
  getAdSlot.mockReturnValue(new Promise((r) => { resolve = r; }));
  await render(<AdSlot slot="notifications_top" onShownChange={shown} />);
  expect(shown).not.toHaveBeenCalled();
  await act(async () => resolve({ kind: 'NETWORK', slot: 'notifications_top', size: 'BANNER', width: 320, height: 50, ad: null }));
  expect(shown).toHaveBeenLastCalledWith(true);
  const banner = await screen.findByTestId('admob-banner');
  await act(async () => banner.props.onAdFailedToLoad());
  await waitFor(() => expect(shown).toHaveBeenLastCalledWith(false));
});

test('NETWORK 배너는 생년월일이 없으면 비맞춤, 성인이면 맞춤으로 요청한다', async () => {
  getAdSlot.mockResolvedValue({ kind: 'NETWORK', slot: 'home_top', size: 'BANNER', width: 320, height: 50, ad: null });
  const first = await render(<AdSlot slot="home_top" />);
  const none = await screen.findByTestId('admob-banner');
  expect(none.props.requestOptions).toEqual({ requestNonPersonalizedAdsOnly: true });
  await first.unmount();
  mockBirthDate = '1990-01-01';
  await render(<AdSlot slot="home_top" />);
  const adult = await screen.findByTestId('admob-banner');
  expect(adult.props.requestOptions).toEqual({ requestNonPersonalizedAdsOnly: false });
});




// SOMA-1075 — 코칭 끝 화면 뒤에 숨은 홈처럼 안 보이는 칸은 어떤 광고인지만 미리 받는다.
test('숨은 화면에서는 광고를 미리 받기만 하고, 이미지가 떠도 노출은 화면이 보인 뒤에 한 번 센다', async () => {
  mockFocused = false;
  getAdSlot.mockResolvedValue({
    kind: 'DIRECT', slot: 'home_top', size: 'BANNER', width: 320, height: 50,
    ad: creative({ image_url: 'https://cdn/a.png', advertiser_name: '한빛연기학원', link_url: 'https://example.com/hanbit' }),
  });
  const view = await render(<AdSlot slot="home_top" />);
  const image = await screen.findByTestId('ad-image');
  expect(getAdSlot).toHaveBeenCalledWith('home_top');
  await act(async () => image.props.onLoad());
  expect(recordAdEvent).not.toHaveBeenCalled();

  mockFocused = true;
  await view.rerender(<AdSlot slot="home_top" />);
  await waitFor(() => expect(recordAdEvent).toHaveBeenCalledWith('ad-1', 'home_top', 'impression'));
  // 다시 숨었다 보여도 같은 광고는 한 번만 센다.
  mockFocused = false;
  await view.rerender(<AdSlot slot="home_top" />);
  mockFocused = true;
  await view.rerender(<AdSlot slot="home_top" />);
  expect(recordAdEvent).toHaveBeenCalledTimes(1);
});

test('숨은 화면에서는 AdMob 배너를 붙이지 않고 채움 시간도 재지 않다가, 보이면 붙인다', async () => {
  mockFocused = false;
  getAdSlot.mockResolvedValue({ kind: 'NETWORK', slot: 'home_top', size: 'BANNER', width: 320, height: 50, ad: null });
  const view = await render(<AdSlot slot="home_top" fillTimeoutMs={30} />);
  await waitFor(() => expect(getAdSlot).toHaveBeenCalled());
  await act(async () => new Promise((resolve) => setTimeout(resolve, 80)));
  expect(screen.queryByTestId('admob-banner')).toBeNull();
  expect(view.toJSON()).not.toBeNull();

  mockFocused = true;
  await view.rerender(<AdSlot slot="home_top" fillTimeoutMs={30} />);
  expect(await screen.findByTestId('admob-banner')).toBeOnTheScreen();
});
