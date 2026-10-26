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
jest.mock('@/lib/api', () => ({
  api: { getAdSlot: jest.fn(), recordAdEvent: jest.fn(() => Promise.resolve()) },
}));

const getAdSlot = api.getAdSlot as jest.Mock;
const recordAdEvent = api.recordAdEvent as jest.Mock;

const creative = (over: Record<string, unknown>) => ({
  id: 'ad-1', image_url: null, headline: null, body: null, app_path: null, advertiser_name: null, ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  setFirstTimeState('practiced');
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

test('학원 광고는 「광고」 라벨과 함께 그리고, 이미지가 뜨면 노출·누르면 클릭을 남기고 상세로 간다', async () => {
  getAdSlot.mockResolvedValue({
    kind: 'DIRECT', slot: 'archive_top', size: 'LARGE_BANNER', width: 320, height: 100,
    ad: creative({ image_url: 'https://cdn/a.png', advertiser_name: '한빛연기학원' }),
  });
  await render(<AdSlot slot="archive_top" />);
  const image = await screen.findByTestId('ad-image');
  expect(screen.getByText('광고')).toBeTruthy();
  image.props.onLoad();
  expect(recordAdEvent).toHaveBeenCalledWith('ad-1', 'archive_top', 'impression');
  fireEvent.press(screen.getByLabelText('광고 한빛연기학원'));
  expect(recordAdEvent).toHaveBeenCalledWith('ad-1', 'archive_top', 'click');
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/ad/[id]', params: { id: 'ad-1' } });
});

test('우리 앱 광고는 문구로 그리고 앱 안 경로로 간다', async () => {
  getAdSlot.mockResolvedValue({
    kind: 'HOUSE', slot: 'profile_top', size: 'BANNER', width: 320, height: 50,
    ad: creative({ id: 'h-1', headline: '이번 주 챌린지 대사가 나왔어요', app_path: '/(tabs)/challenges' }),
  });
  await render(<AdSlot slot="profile_top" />);
  fireEvent.press(await screen.findByText('이번 주 챌린지 대사가 나왔어요'));
  expect(mockPush).toHaveBeenCalledWith('/(tabs)/challenges');
});

test('서버 오류(게스트 403 등)면 칸을 비운다', async () => {
  getAdSlot.mockRejectedValue(Object.assign(new Error('member_only'), { status: 403 }));
  const view = await render(<AdSlot slot="line_search_top" />);
  await waitFor(() => expect(view.toJSON()).toBeNull());
});
