import { act, render } from '@testing-library/react-native';
import { AppState, Platform } from 'react-native';

import { api } from '@/lib/api';
import { setFirstTimeState } from '@/lib/practice/first-time';

// 전면 광고(SOMA-1085) — 불러오기·닫기·실패·시간 초과(showInterstitial)와 띄울지 고르기(useFullScreenAd).

type Listener = () => void;
let mockAds: { listeners: Map<string, Listener>; load: jest.Mock; show: jest.Mock; options: unknown }[] = [];
let mockBehavior: 'close' | 'error' | 'never' | 'show-fails' | 'open-only' = 'close';

let mockRewarded: { listeners: Map<string, Listener>; load: jest.Mock; show: jest.Mock; unit: string; options: unknown }[] = [];
let mockRewardBehavior: 'earn' | 'close-early' | 'error' | 'never' = 'earn';

jest.mock('react-native-google-mobile-ads', () => ({
  AdEventType: { LOADED: 'loaded', OPENED: 'opened', CLICKED: 'clicked', CLOSED: 'closed', ERROR: 'error' },
  RewardedAdEventType: { LOADED: 'rewarded_loaded', EARNED_REWARD: 'rewarded_earned_reward' },
  RewardedAd: {
    createForAdRequest: (unit: string, options: unknown) => {
      const ad = {
        listeners: new Map<string, Listener>(),
        unit,
        options,
        load: jest.fn(() => {
          if (mockRewardBehavior === 'error') ad.listeners.get('error')?.();
          else if (mockRewardBehavior !== 'never') ad.listeners.get('rewarded_loaded')?.();
        }),
        show: jest.fn(() => {
          ad.listeners.get('opened')?.();
          if (mockRewardBehavior === 'earn') ad.listeners.get('rewarded_earned_reward')?.();
          ad.listeners.get('closed')?.();
          return Promise.resolve();
        }),
        addAdEventListener: (type: string, listener: Listener) => {
          ad.listeners.set(type, listener);
          return () => ad.listeners.delete(type);
        },
      };
      mockRewarded.push(ad);
      return ad;
    },
  },
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
          ad.listeners.get('opened')?.();
          if (mockBehavior === 'open-only') return Promise.resolve();
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
const { showInterstitial, showRewarded } = jest.requireActual('@/lib/full-screen-ad') as typeof import('@/lib/full-screen-ad');
const pick = (kind: string) => ({ kind, slot: 'reading_done_full', size: 'MEDIUM_RECTANGLE', width: 300, height: 250, ad: null });

beforeEach(() => {
  mockAds = [];
  mockBehavior = 'close';
  mockRewarded = [];
  mockRewardBehavior = 'earn';
  jest.mocked(api.getAdSlot).mockReset();
});

describe('showRewarded (SOMA-1067)', () => {
  const verification = { userId: '11111111-1111-4111-8111-111111111111', customData: 'req-1' };

  test('서버 측 확인 옵션(userId·customData)을 실어 요청하고, 끝까지 보면 earned — 띄우기 전에 beforeShow 를 기다린다', async () => {
    const order: string[] = [];
    const result = showRewarded('rewarded-unit', true, verification, 8000, {
      beforeShow: async () => {
        order.push('before');
      },
      onOpened: () => order.push('opened'),
    });
    await expect(result).resolves.toBe('earned');
    expect(mockRewarded[0].unit).toBe('rewarded-unit');
    expect(mockRewarded[0].options).toEqual({
      requestNonPersonalizedAdsOnly: true,
      serverSideVerificationOptions: { userId: verification.userId, customData: 'req-1' },
    });
    expect(order).toEqual(['before', 'opened']);
    expect(mockRewarded[0].listeners.size).toBe(0);
  });

  test('보상 전에 닫으면 closed, 못 불러오면 failed', async () => {
    mockRewardBehavior = 'close-early';
    await expect(showRewarded('u', false, verification)).resolves.toBe('closed');
    mockRewardBehavior = 'error';
    await expect(showRewarded('u', false, verification)).resolves.toBe('failed');
  });

  test('시간 안에 못 불러오면 failed, 그 뒤에 불러와져도 띄우지 않는다', async () => {
    jest.useFakeTimers();
    try {
      mockRewardBehavior = 'never';
      const result = showRewarded('u', false, verification, 1000);
      jest.advanceTimersByTime(1000);
      await expect(result).resolves.toBe('failed');
      mockRewarded[0].listeners.get('rewarded_loaded')?.();
      expect(mockRewarded[0].show).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
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

describe('showInterstitial 보는 기록 (SOMA-1129)', () => {
  test('열리면 onOpened, 닫히면 onDone 에 본 시간·누름·나감을 준다', async () => {
    const onOpened = jest.fn();
    const onDone = jest.fn();
    const result = showInterstitial('unit', false, 4000, { onOpened, onDone });
    await expect(result).resolves.toBe('shown');
    expect(onOpened).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ clicked: false, leftApp: false }));
    expect(typeof onDone.mock.calls[0][0].watchedMs).toBe('number');
  });

  test('광고를 누른 뒤 닫히면 clicked 가 true 다', async () => {
    mockBehavior = 'open-only';
    const onDone = jest.fn();
    const result = showInterstitial('unit', false, 4000, { onDone });
    await Promise.resolve();
    mockAds[0].listeners.get('clicked')?.();
    mockAds[0].listeners.get('closed')?.();
    await expect(result).resolves.toBe('shown');
    expect(onDone.mock.calls[0][0].clicked).toBe(true);
  });

  test('iOS 에서 광고를 보다 앱을 벗어나면 onLeftApp, 광고를 눌러 나가면 세지 않는다', async () => {
    expect(Platform.OS).toBe('ios'); // jest-expo 기본 플랫폼
    let onChange: ((state: string) => void) | null = null;
    const remove = jest.fn();
    const original = AppState.addEventListener;
    AppState.addEventListener = ((_type: string, handler: (state: string) => void) => {
      onChange = handler;
      return { remove };
    }) as never;
    try {
      mockBehavior = 'open-only';
      const onLeftApp = jest.fn();
      const onDone = jest.fn();
      const result = showInterstitial('unit', false, 4000, { onLeftApp, onDone });
      await Promise.resolve();
      (onChange as unknown as (state: string) => void)('background');
      (onChange as unknown as (state: string) => void)('background');
      mockAds[0].listeners.get('closed')?.();
      await expect(result).resolves.toBe('shown');
      expect(onLeftApp).toHaveBeenCalledTimes(1);
      expect(onDone.mock.calls[0][0].leftApp).toBe(true);
      expect(remove).toHaveBeenCalled();

      onLeftApp.mockClear();
      const second = showInterstitial('unit', false, 4000, { onLeftApp });
      await Promise.resolve();
      mockAds[1].listeners.get('clicked')?.();
      (onChange as unknown as (state: string) => void)('background');
      mockAds[1].listeners.get('closed')?.();
      await expect(second).resolves.toBe('shown');
      expect(onLeftApp).not.toHaveBeenCalled();
    } finally {
      AppState.addEventListener = original;
    }
  });

  test('못 불러오면 onOpened 없이 본 시간은 null 이다', async () => {
    mockBehavior = 'error';
    const onOpened = jest.fn();
    const onDone = jest.fn();
    await expect(showInterstitial('unit', false, 4000, { onOpened, onDone })).resolves.toBe('skipped');
    expect(onOpened).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledWith({ watchedMs: null, clicked: false, leftApp: false });
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
    const { logEvent } = jest.requireMock('@/lib/analytics') as { logEvent: jest.Mock };
    expect(logEvent).toHaveBeenCalledWith('ad_full_screen_opened', { slot: 'reading_done_full' });
    expect(logEvent).toHaveBeenCalledWith(
      'ad_full_screen_shown',
      expect.objectContaining({ slot: 'reading_done_full', clicked: false, left_app: false, watched_ms: expect.any(Number) }),
    );
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
