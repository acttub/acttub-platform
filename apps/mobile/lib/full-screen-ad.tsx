/**
 * 전면 광고 띄우기(SOMA-1085) — 코칭 분석 대기, 대본 나누기 시작, 리딩 끝(결과로 넘어갈 때).
 *
 * show(slot) 는 서버(GET /v2/ads)에 칸을 묻고, NETWORK 이면(무료·첫 연습 뒤·칸 스위치 켜짐) 3분 간격과 AdMob 준비를 확인한 뒤
 * AdMob 전면 광고를 띄운다. 광고를 못 불러오면 광고 없이 끝난다 — 부르는 화면은 기다리지 않아도 되고, 기다리더라도 몇 초 안에 끝난다.
 * 첫 사용자 여부는 화면에 들어온 때의 값을 쓴다(첫 리딩을 막 끝낸 순간에는 이미 연습한 사람으로 바뀌어 있다).
 */
import { useCallback, useRef } from 'react';
import { Platform } from 'react-native';

import { fullScreenAllowed, interstitialUnitFor, type FullScreenSlotKey } from '@/lib/ads';
import { isAdMobReady, nonPersonalizedAdsOnly } from '@/lib/ads-native';
import { logEvent } from '@/lib/analytics';
import { api } from '@/lib/api';
import { getFirstTimeState } from '@/lib/practice/first-time';

const API_URL = process.env.EXPO_PUBLIC_API_URL;

/** 마지막으로 전면 광고를 닫은 시각 — 앱을 켜 둔 동안 3분 간격을 지킨다. */
let lastShownAt: number | null = null;
/** 이미 하나를 띄우는 중이면 겹쳐 띄우지 않는다. */
let showing = false;

export type FullScreenResult = 'shown' | 'skipped';

/**
 * AdMob 전면 광고를 불러와 띄운다(SOMA-1085). 닫히면 'shown', 못 불러오면(오류·시간 초과·모듈 없음) 'skipped'.
 * loadTimeoutMs 안에 못 불러오면 그 뒤에 불러와져도 띄우지 않는다 — 사용자가 이미 다음 화면으로 갔을 수 있다.
 * 건너뛰기 시간(5초)은 AdMob 앱 설정 「높은 참여도 광고」를 끈 값이다 — 앱이 정하지 못한다.
 */
export function showInterstitial(unitId: string, nonPersonalized: boolean, loadTimeoutMs = 4000): Promise<FullScreenResult> {
  return new Promise((resolve) => {
    let module: any;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      module = require('react-native-google-mobile-ads');
    } catch {
      resolve('skipped');
      return;
    }
    const { InterstitialAd, AdEventType } = module;
    let settled = false;
    let loaded = false;
    const unsubscribers: (() => void)[] = [];
    const finish = (result: FullScreenResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribers.forEach((unsubscribe) => unsubscribe());
      resolve(result);
    };
    const timer = setTimeout(() => {
      if (!loaded) finish('skipped');
    }, loadTimeoutMs);
    try {
      const ad = InterstitialAd.createForAdRequest(unitId, { requestNonPersonalizedAdsOnly: nonPersonalized });
      unsubscribers.push(
        ad.addAdEventListener(AdEventType.LOADED, () => {
          if (settled) return;
          loaded = true;
          Promise.resolve(ad.show()).catch(() => finish('skipped'));
        }),
        ad.addAdEventListener(AdEventType.CLOSED, () => finish('shown')),
        ad.addAdEventListener(AdEventType.ERROR, () => finish('skipped')),
      );
      ad.load();
    } catch {
      finish('skipped');
    }
  });
}


export function useFullScreenAd(): (slot: FullScreenSlotKey) => Promise<FullScreenResult> {
  const firstTimeAtStart = useRef(getFirstTimeState());
  return useCallback(
    async (slot: FullScreenSlotKey) => {
      if (showing || Platform.OS === 'web') return 'skipped';
      const unit = interstitialUnitFor(Platform.OS === 'ios' ? 'ios' : 'android', API_URL);
      if (!unit || !isAdMobReady()) return 'skipped';
      showing = true;
      try {
        const pick = await api.getAdSlot(slot).catch(() => null);
        if (!fullScreenAllowed({ pick, firstTime: firstTimeAtStart.current, lastShownAt, now: Date.now() })) return 'skipped';
        // 나이별 요청 설정(청소년이면 비맞춤)은 앱이 프로필을 받을 때마다 광고 모듈에 걸어 둔 값을 쓴다
        const result = await showInterstitial(unit, nonPersonalizedAdsOnly());
        if (result === 'shown') {
          lastShownAt = Date.now();
          logEvent('ad_full_screen_shown', { slot });
        }
        return result;
      } finally {
        showing = false;
      }
    },
    [],
  );
}
