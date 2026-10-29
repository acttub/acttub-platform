import { Linking } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { api } from '@/lib/api';
import { setFirstTimeState } from '@/lib/practice/first-time';

const { AdSlot } = jest.requireActual('@/components/ad-slot') as typeof import('@/components/ad-slot');

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('expo-image', () => {
  const { View } = jest.requireActual('react-native');
  return { Image: (props: Record<string, unknown>) => <View testID="ad-image" {...props} /> };
});
jest.mock('@/lib/analytics', () => ({ logEvent: jest.fn() }));
jest.mock('@/lib/ads-native', () => ({
  loadBannerModule: () => {
    const { View } = jest.requireActual('react-native');
    return {
      BannerAd: (props: Record<string, unknown>) => <View testID="admob-banner" {...props} />,
      BannerAdSize: { BANNER: 'BANNER', LARGE_BANNER: 'LARGE_BANNER', MEDIUM_RECTANGLE: 'MEDIUM_RECTANGLE' },
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

test('NETWORK 면 칸 규격의 AdMob 배너(테스트 단위)를 그린다', async () => {
  getAdSlot.mockResolvedValue({ kind: 'NETWORK', slot: 'home_top', size: 'BANNER', width: 320, height: 50, ad: null });
  await render(<AdSlot slot="home_top" />);
  const banner = await screen.findByTestId('admob-banner');
  expect(banner.props.size).toBe('BANNER');
  expect(banner.props.unitId).toMatch(/^ca-app-pub-3940256099942544\//);
});

test('직접 광고는 「광고」 라벨과 함께 그리고, 이미지가 뜨면 노출·누르면 클릭을 남기고 광고주 링크를 앱 밖으로 연다', async () => {
  getAdSlot.mockResolvedValue({
    kind: 'DIRECT', slot: 'archive_top', size: 'LARGE_BANNER', width: 320, height: 100,
    ad: creative({ image_url: 'https://cdn/a.png', advertiser_name: '한빛연기학원', link_url: 'https://example.com/hanbit' }),
  });
  await render(<AdSlot slot="archive_top" />);
  const image = await screen.findByTestId('ad-image');
  expect(screen.getByText('광고')).toBeTruthy();
  image.props.onLoad();
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

test('NETWORK 배너는 생년월일이 없으면 비맞춤, 성인이면 맞춤으로 요청한다', async () => {
  getAdSlot.mockResolvedValue({ kind: 'NETWORK', slot: 'home_top', size: 'BANNER', width: 320, height: 50, ad: null });
  const first = await render(<AdSlot slot="home_top" />);
  const none = await screen.findByTestId('admob-banner');
  expect(none.props.requestOptions).toEqual({ requestNonPersonalizedAdsOnly: true });
  first.unmount();
  mockBirthDate = '1990-01-01';
  await render(<AdSlot slot="home_top" />);
  const adult = await screen.findByTestId('admob-banner');
  expect(adult.props.requestOptions).toEqual({ requestNonPersonalizedAdsOnly: false });
});
