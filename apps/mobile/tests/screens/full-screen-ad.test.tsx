import { act, render } from '@testing-library/react-native';

import { api } from '@/lib/api';
import { setFirstTimeState } from '@/lib/practice/first-time';

// 전면 광고(SOMA-1085) — 불러오기·닫기·실패·시간 초과(showInterstitial)와 띄울지 고르기(useFullScreenAd).

type Listener = () => void;
let mockAds: { listeners: Map<string, Listener>; load: jest.Mock; show: jest.Mock; options: unknown }[] = [];
let mockBehavior: 'close' | 'error' | 'never' | 'show-fails' = 'close';

jest.mock('react-native-google-mobile-ads', () => ({
  AdEventType: { LOADED: 'loaded', CLOSED: 'closed', ERROR: 'error' },
  InterstitialAd: {
    createForAdRequest: (_unit: string, options: unknown) => {
      const ad = {
        listeners: new Map<string, Listener>(),
        options,
        load: jest.fn(() => {
          if (mockBehavior === 'error') ad.listeners.get('error')?.();
          else if (mockBehavior !== 'never') ad.listeners.get('loaded')?.();
        }),
        show: jest.fn(() => {
          if (mockBehavior === 'show-fails') return Promise.reject(new Error('no activity'));
          ad.listeners.get('closed')?.();
          return Promise.resolve();
        }),
        addAdEventListener: (type: string, listener: Listener) => {
          ad.listeners.set(type, listener);
          return () => ad.listeners.delete(type);
        },
      };
      mockAds.push(ad);
      return ad;
    },
  },
}));
jest.mock('@/lib/analytics', () => ({ logEvent: jest.fn() }));
jest.mock('@/lib/api', () => ({ api: { getAdSlot: jest.fn() } }));

const native = jest.requireActual('@/lib/ads-native') as typeof import('@/lib/ads-native');
const { showInterstitial } = jest.requireActual('@/lib/full-screen-ad') as typeof import('@/lib/full-screen-ad');
const pick = (kind: string) => ({ kind, slot: 'reading_done_full', size: 'MEDIUM_RECTANGLE', width: 300, height: 250, ad: null });

beforeEach(() => {
  mockAds = [];
  mockBehavior = 'close';
  jest.mocked(api.getAdSlot).mockReset();
});

describe('showInterstitial', () => {
  test('불러오면 띄우고, 닫으면 shown — 청소년이면 비맞춤으로 요청한다', async () => {
    await expect(showInterstitial('unit', true)).resolves.toBe('shown');
    expect(mockAds[0].show).toHaveBeenCalled();
    expect(mockAds[0].options).toEqual({ requestNonPersonalizedAdsOnly: true });
    expect(mockAds[0].listeners.size).toBe(0);
  });

  test('못 불러오거나 띄우지 못하면 skipped', async () => {
    mockBehavior = 'error';
    await expect(showInterstitial('unit', false)).resolves.toBe('skipped');
    mockBehavior = 'show-fails';
    await expect(showInterstitial('unit', false)).resolves.toBe('skipped');
  });

  test('시간 안에 못 불러오면 skipped, 그 뒤에 불러와져도 띄우지 않는다', async () => {
    jest.useFakeTimers();
    try {
      mockBehavior = 'never';
      const result = showInterstitial('unit', false, 1000);
      jest.advanceTimersByTime(1000);
      await expect(result).resolves.toBe('skipped');
      mockAds[0].listeners.get('loaded')?.();
      expect(mockAds[0].show).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('useFullScreenAd', () => {
  async function setUp(firstTime: 'first' | 'practiced') {
    setFirstTimeState(firstTime);
    await native.initAdMob();
    const { useFullScreenAd } = jest.requireActual('@/lib/full-screen-ad') as typeof import('@/lib/full-screen-ad');
    let show: ReturnType<typeof useFullScreenAd> | null = null;
    function Probe() {
      show = useFullScreenAd();
      return null;
    }
    await act(async () => {
      render(<Probe />);
    });
    return show as unknown as ReturnType<typeof useFullScreenAd>;
  }

  test('서버가 NETWORK 를 주면 띄우고, 3분 안에는 다시 띄우지 않는다. NONE 이면 띄우지 않는다', async () => {
    const show = await setUp('practiced');
    jest.mocked(api.getAdSlot).mockResolvedValue(pick('NONE') as never);
    await act(async () => expect(await show('reading_done_full')).toBe('skipped'));
    expect(mockAds).toHaveLength(0);

    jest.mocked(api.getAdSlot).mockResolvedValue(pick('NETWORK') as never);
    await act(async () => expect(await show('reading_done_full')).toBe('shown'));
    expect(api.getAdSlot).toHaveBeenLastCalledWith('reading_done_full');
    await act(async () => expect(await show('analyzing_wait_full')).toBe('skipped'));
    expect(mockAds).toHaveLength(1);
  });

  test('화면에 들어올 때 첫 사용자였으면 띄우지 않는다', async () => {
    const show = await setUp('first');
    jest.mocked(api.getAdSlot).mockResolvedValue(pick('NETWORK') as never);
    setFirstTimeState('practiced');
    await act(async () => expect(await show('reading_done_full')).toBe('skipped'));
    expect(mockAds).toHaveLength(0);
  });
});
