/**
 * AdMob SDK 초기화(SOMA-876). 네이티브 모듈은 development build 이상에만 있으므로 함수 안 require 로 가드한다.
 * iOS ATT 는 따로 묻지 않는다 — app/_layout 이 Meta SDK 초기화(ATT 요청 포함)를 끝낸 뒤 이 함수를 부른다.
 */
import { adRequestConfigFor, type AdRequestConfig } from './ads.ts';

let started: Promise<void> | null = null;
/** 프로필을 받기 전 기본값 — 청소년 기준(G·미성년·비맞춤). */
let current: AdRequestConfig = adRequestConfigFor(null, '1970-01-01');

function applyRequestConfiguration(mobileAds: { setRequestConfiguration: (c: object) => Promise<void> }) {
  return mobileAds.setRequestConfiguration({
    maxAdContentRating: current.maxAdContentRating,
    tagForUnderAgeOfConsent: current.tagForUnderAgeOfConsent,
    tagForChildDirectedTreatment: current.tagForChildDirectedTreatment,
  });
}

/**
 * 프로필(생년월일)이 바뀔 때마다 전역 요청 설정을 다시 건다. 초기화 전이면 초기화 때 현재 값으로 걸린다.
 * 로그아웃·계정 전환으로 프로필이 없어지면 청소년 기준으로 돌아간다.
 */
export async function setAdRequestConfig(next: AdRequestConfig): Promise<void> {
  current = next;
  if (!started) return;
  try {
    await started;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    await applyRequestConfiguration(require('react-native-google-mobile-ads').default());
  } catch {
    // 네이티브 모듈 없음 — 무시
  }
}

export function initAdMob(): Promise<void> {
  if (started) return started;
  started = (async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const module = require('react-native-google-mobile-ads');
      const mobileAds = module.default();
      await applyRequestConfiguration(mobileAds);
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
