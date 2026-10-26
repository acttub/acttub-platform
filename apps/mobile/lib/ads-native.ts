/**
 * AdMob SDK 초기화(SOMA-876). 네이티브 모듈은 development build 이상에만 있으므로 함수 안 require 로 가드한다.
 * iOS ATT 는 따로 묻지 않는다 — app/_layout 이 Meta SDK 초기화(ATT 요청 포함)를 끝낸 뒤 이 함수를 부른다.
 */
import { AD_MAX_CONTENT_RATING } from '@/lib/ads';

let started: Promise<void> | null = null;

export function initAdMob(): Promise<void> {
  if (started) return started;
  started = (async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const module = require('react-native-google-mobile-ads');
      const mobileAds = module.default();
      if (AD_MAX_CONTENT_RATING) {
        await mobileAds.setRequestConfiguration({ maxAdContentRating: AD_MAX_CONTENT_RATING });
      }
      await mobileAds.initialize();
    } catch {
      // 네이티브 모듈 없음(Expo Go·웹·테스트) 또는 초기화 실패 — 광고 없이 앱은 그대로 돈다
    }
  })();
  return started;
}

/** AdMob 배너 컴포넌트와 규격. 모듈이 없으면 null — 칸을 비운다. */
export function loadBannerModule(): {
  BannerAd: React.ComponentType<Record<string, unknown>>;
  BannerAdSize: Record<string, string>;
} | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const module = require('react-native-google-mobile-ads');
    return { BannerAd: module.BannerAd, BannerAdSize: module.BannerAdSize };
  } catch {
    return null;
  }
}
