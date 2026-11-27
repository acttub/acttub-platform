/**
 * 전면 광고 띄우기(SOMA-1085) — 코칭 분석 대기, 대본 나누기 시작, 리딩 끝(결과로 넘어갈 때).
 *
 * show(slot) 는 서버(GET /v2/ads)에 칸을 묻고, NETWORK 이면(무료·첫 연습 뒤·칸 스위치 켜짐) 3분 간격과 AdMob 준비를 확인한 뒤
 * AdMob 전면 광고를 띄운다. 광고를 못 불러오면 광고 없이 끝난다 — 부르는 화면은 기다리지 않아도 되고, 기다리더라도 몇 초 안에 끝난다.
 * 첫 사용자 여부는 화면에 들어온 때의 값을 쓴다(첫 리딩을 막 끝낸 순간에는 이미 연습한 사람으로 바뀌어 있다).
 */
import { useCallback, useRef } from 'react';
import { AppState, Platform } from 'react-native';

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
 * 광고를 어떻게 봤는지(SOMA-1129). watchedMs 는 광고가 열린 때부터 닫힌 때까지다 — 보는 중 앱을 벗어났다 돌아오면 그 시간도 들어간다.
 * leftApp 은 iOS 에서만 잰다: 안드로이드는 광고가 따로 화면(Activity)으로 떠서 광고를 보는 동안에도 앱이 백그라운드로 보인다.
 */
export type AdWatch = { watchedMs: number | null; clicked: boolean; leftApp: boolean };
export type AdWatchHooks = {
  /** 광고가 화면에 떴다. */
  onOpened?: () => void;
  /** 광고를 보는 중 앱을 벗어났다(광고를 눌러 나간 경우는 빼고). iOS 만. */
  onLeftApp?: (watchedMs: number) => void;
  /** 광고가 닫혔다(또는 못 띄우고 끝났다). */
  onDone?: (watch: AdWatch) => void;
};

/**
 * AdMob 전면 광고를 불러와 띄운다(SOMA-1085). 닫히면 'shown', 못 불러오면(오류·시간 초과·모듈 없음) 'skipped'.
 * loadTimeoutMs 안에 못 불러오면 그 뒤에 불러와져도 띄우지 않는다 — 사용자가 이미 다음 화면으로 갔을 수 있다.
 * 건너뛰기 시간(5초)은 AdMob 앱 설정 「높은 참여도 광고」를 끈 값이다 — 앱이 정하지 못한다.
 */
export function showInterstitial(
  unitId: string,
  nonPersonalized: boolean,
  loadTimeoutMs = 4000,
  hooks: AdWatchHooks = {},
): Promise<FullScreenResult> {
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
    let openedAt: number | null = null;
    let clicked = false;
    let leftApp = false;
    const unsubscribers: (() => void)[] = [];
    const finish = (result: FullScreenResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribers.forEach((unsubscribe) => {
        try {
          unsubscribe();
        } catch {
          // 구독 해제가 실패해도 광고 결과는 돌려준다 — 부르는 화면이 멈추면 안 된다
        }
      });
      hooks.onDone?.({ watchedMs: openedAt === null ? null : Date.now() - openedAt, clicked, leftApp });
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
        ad.addAdEventListener(AdEventType.OPENED, () => {
          if (settled || openedAt !== null) return;
          openedAt = Date.now();
          hooks.onOpened?.();
          if (Platform.OS === 'ios') {
            const sub = AppState.addEventListener('change', (next) => {
              if (next !== 'background' || clicked || leftApp || openedAt === null) return;
              leftApp = true;
              hooks.onLeftApp?.(Date.now() - openedAt);
            });
            unsubscribers.push(() => sub?.remove());
          }
        }),
        ad.addAdEventListener(AdEventType.CLICKED, () => {
          clicked = true;
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

/** 보상형 광고 결과(SOMA-1067). earned 는 끝까지 봤다(보상 받음), closed 는 보상 전에 닫았다, failed 는 못 불러왔거나 못 띄웠다. */
export type RewardedResult = 'earned' | 'closed' | 'failed';

/**
 * AdMob 보상형 광고를 불러와 띄운다(SOMA-1067). 서버 측 확인 옵션(userId = 회원 id, customData = 1회용 요청 id)을 실어
 * AdMob 이 서버 콜백에 그대로 넘기게 한다. 보상은 서버가 콜백을 받아야 들어간다 — earned 는 앱 쪽 신호일 뿐이다.
 * loadTimeoutMs 안에 못 불러오면 failed 이고 그 뒤에 불러와져도 띄우지 않는다.
 */
export function showRewarded(
  unitId: string,
  nonPersonalized: boolean,
  verification: { userId: string; customData: string },
  loadTimeoutMs = 8000,
  hooks: {
    /** 불러온 뒤 띄우기 직전. 돌려준 약속이 끝나야 띄운다(확인창을 먼저 내릴 때). */
    beforeShow?: () => Promise<void>;
    onOpened?: () => void;
  } = {},
): Promise<RewardedResult> {
  return new Promise((resolve) => {
    let module: any;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      module = require('react-native-google-mobile-ads');
    } catch {
      resolve('failed');
      return;
    }
    const { RewardedAd, RewardedAdEventType, AdEventType } = module;
    let settled = false;
    let loaded = false;
    let earned = false;
    const unsubscribers: (() => void)[] = [];
    const finish = (result: RewardedResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribers.forEach((unsubscribe) => {
        try {
          unsubscribe();
        } catch {
          // 구독 해제가 실패해도 결과는 돌려준다
        }
      });
      resolve(result);
    };
    const timer = setTimeout(() => {
      if (!loaded) finish('failed');
    }, loadTimeoutMs);
    try {
      const ad = RewardedAd.createForAdRequest(unitId, {
        requestNonPersonalizedAdsOnly: nonPersonalized,
        serverSideVerificationOptions: { userId: verification.userId, customData: verification.customData },
      });
      unsubscribers.push(
        ad.addAdEventListener(RewardedAdEventType.LOADED, () => {
          if (settled) return;
          loaded = true;
          Promise.resolve(hooks.beforeShow?.())
            .then(() => (settled ? undefined : ad.show()))
            .catch(() => finish('failed'));
        }),
        ad.addAdEventListener(RewardedAdEventType.EARNED_REWARD, () => {
          earned = true;
        }),
        ad.addAdEventListener(AdEventType.OPENED, () => hooks.onOpened?.()),
        ad.addAdEventListener(AdEventType.CLOSED, () => finish(earned ? 'earned' : 'closed')),
        ad.addAdEventListener(AdEventType.ERROR, () => finish('failed')),
      );
      ad.load();
    } catch {
      finish('failed');
    }
  });
}

export function useFullScreenAd():(slot: FullScreenSlotKey) => Promise<FullScreenResult> {
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
        // 광고 뒤 이탈을 재려고 열림·보는 중 나감·닫힘을 남긴다(SOMA-1129). 열림만 있고 닫힘이 없으면 광고를 보다 앱을 끈 것이다.
        let watch: AdWatch | null = null;
        const result = await showInterstitial(unit, nonPersonalizedAdsOnly(), undefined, {
          onOpened: () => logEvent('ad_full_screen_opened', { slot }),
          onLeftApp: (watchedMs) => logEvent('ad_full_screen_left', { slot, watched_ms: watchedMs }),
          onDone: (done) => {
            watch = done;
          },
        });
        if (result === 'shown') {
          lastShownAt = Date.now();
          const seen = watch as AdWatch | null;
          logEvent('ad_full_screen_shown', {
            slot,
            ...(seen?.watchedMs != null ? { watched_ms: seen.watchedMs } : {}),
            clicked: seen?.clicked ?? false,
            left_app: seen?.leftApp ?? false,
          });
        }
        return result;
      } finally {
        showing = false;
      }
    },
    [],
  );
}
