/**
 * 광고 칸(SOMA-876) — 칸 목록·규격·AdMob 광고 단위·칸 높이 계산. 서버(GET /v2/ads)가 칸마다
 * DIRECT(광고주)·HOUSE(우리 앱)·NETWORK(AdMob)·NONE 중 하나를 고르고, 앱은 그대로 그린다.
 *
 * ⚠️ CI 가 `node --test` 로 이 파일을 그대로 import 한다 — react-native·expo 모듈을 최상위에서 import 하지 않는다.
 */

import { isProductionApiUrl } from './api-env.ts';
import { fullYearsOn } from './profile-form.ts';

export type AdSize = 'LARGE_BANNER' | 'BANNER' | 'MEDIUM_RECTANGLE';
export type AdKind = 'DIRECT' | 'HOUSE' | 'NETWORK' | 'NONE';
/** 둘러보기(무료·Pro 모두), 연습 중(무료만, 서버 A/B), 게시판(SOMA-873, 아직 화면 없음). */
export type AdPhase = 'browse' | 'practice' | 'community';

export const AD_SIZES: Record<AdSize, { width: number; height: number }> = {
  LARGE_BANNER: { width: 320, height: 100 },
  BANNER: { width: 320, height: 50 },
  MEDIUM_RECTANGLE: { width: 300, height: 250 },
};

/** 서버 AdSlot 과 같은 키. 규격이 서버와 다르면 서버 응답의 size 를 따른다. */
export const AD_SLOTS = {
  auditions_top: { size: 'LARGE_BANNER', phase: 'browse' },
  admissions_top: { size: 'LARGE_BANNER', phase: 'browse' },
  admission_detail_top: { size: 'LARGE_BANNER', phase: 'browse' },
  reading_tab_top: { size: 'LARGE_BANNER', phase: 'browse' },
  challenges_tab_top: { size: 'LARGE_BANNER', phase: 'browse' },
  challenge_detail_top: { size: 'LARGE_BANNER', phase: 'browse' },
  archive_top: { size: 'LARGE_BANNER', phase: 'browse' },
  saved_videos_top: { size: 'LARGE_BANNER', phase: 'browse' },
  home_top: { size: 'BANNER', phase: 'browse' },
  profile_top: { size: 'BANNER', phase: 'browse' },
  settings_top: { size: 'BANNER', phase: 'browse' },
  analyzing_top: { size: 'BANNER', phase: 'browse' },
  notifications_top: { size: 'BANNER', phase: 'browse' },
  line_search_top: { size: 'BANNER', phase: 'browse' },
  analyzing_wait: { size: 'MEDIUM_RECTANGLE', phase: 'practice' },
  voice_prepare_wait: { size: 'MEDIUM_RECTANGLE', phase: 'practice' },
  upload_wait: { size: 'LARGE_BANNER', phase: 'practice' },
  script_parse_wait: { size: 'LARGE_BANNER', phase: 'practice' },
  coaching_done: { size: 'LARGE_BANNER', phase: 'practice' },
  challenge_upload_done: { size: 'LARGE_BANNER', phase: 'practice' },
  community_list_top: { size: 'BANNER', phase: 'community' },
  community_post_top: { size: 'BANNER', phase: 'community' },
  // 전면 칸(SOMA-1085) — 배너가 아니라 화면 전체를 덮는 AdMob 전면 광고. 규격은 서버 응답 모양을 맞추려고 둘 뿐 쓰지 않는다.
  analyzing_wait_full: { size: 'MEDIUM_RECTANGLE', phase: 'practice' },
  script_parse_full: { size: 'MEDIUM_RECTANGLE', phase: 'practice' },
  reading_done_full: { size: 'MEDIUM_RECTANGLE', phase: 'practice' },
} as const satisfies Record<string, { size: AdSize; phase: AdPhase }>;

export type AdSlotKey = keyof typeof AD_SLOTS;

export type AdCreative = {
  id: string;
  image_url: string | null;
  headline: string | null;
  body: string | null;
  app_path: string | null;
  advertiser_name: string | null;
  /** DIRECT 의 광고주 링크(http/https). 누르면 앱 밖 브라우저로 연다. */
  link_url: string | null;
};

export type AdSlotPick = {
  kind: AdKind;
  slot: string;
  size: AdSize;
  width: number;
  height: number;
  ad: AdCreative | null;
  /** NETWORK 일 때 AdMob 이 안 채워지면 대신 그릴 우리 앱 광고(SOMA-1030). 옛 서버는 보내지 않는다. */
  fallback?: AdCreative | null;
};

/** 광고 칸 모서리·라벨 — 디자인 결정(SOMA-876). */
export const AD_RADIUS = 16;
export const AD_LABEL = {
  text: '광고',
  background: 'rgba(0,0,0,0.45)',
  radius: 4,
  fontSize: 10,
  inset: 6,
} as const;

/** 만 19세 미만은 청소년이다(청소년 보호법 기준). */
export const AD_ADULT_AGE = 19;
/** 만 13세 미만은 아동 대상 처리(tagForChildDirectedTreatment)도 켠다. */
export const AD_CHILD_AGE = 13;

export type AdRequestConfig = {
  /** 전역 요청 설정 — mobileAds().setRequestConfiguration 에 그대로 넘긴다. */
  maxAdContentRating: 'G' | 'T';
  tagForUnderAgeOfConsent: boolean;
  tagForChildDirectedTreatment: boolean;
  /** 배너별 요청 옵션 — BannerAd requestOptions.requestNonPersonalizedAdsOnly. */
  requestNonPersonalizedAdsOnly: boolean;
};

/**
 * 나이로 AdMob 요청 설정을 고른다(SOMA-876).
 * - 만 19세 이상: 콘텐츠 등급 T, 그 밖의 설정은 기본(맞춤 광고 허용).
 * - 만 19세 미만: G + 미성년 표시 + 비맞춤 광고. 만 13세 미만이면 아동 대상 처리도 켠다.
 * - 생년월일이 없거나(null·형식 오류) 프로필을 아직 못 받았으면 청소년 기준(G·미성년·비맞춤)이다. 아동 표시는 켜지 않는다.
 * today 와 birthDate 는 'YYYY-MM-DD'.
 */
export function adRequestConfigFor(birthDate: string | null | undefined, today: string): AdRequestConfig {
  const valid = !!birthDate && /^\d{4}-\d{2}-\d{2}$/.test(birthDate);
  const age = valid ? fullYearsOn(birthDate, today) : null;
  if (age !== null && age >= AD_ADULT_AGE) {
    return {
      maxAdContentRating: 'T',
      tagForUnderAgeOfConsent: false,
      tagForChildDirectedTreatment: false,
      requestNonPersonalizedAdsOnly: false,
    };
  }
  return {
    maxAdContentRating: 'G',
    tagForUnderAgeOfConsent: true,
    tagForChildDirectedTreatment: age !== null && age < AD_CHILD_AGE,
    requestNonPersonalizedAdsOnly: true,
  };
}

/** Google 공식 테스트 배너 광고 단위. 개발·dev 빌드는 늘 이것만 쓴다. */
export const TEST_BANNER_UNIT = {
  android: 'ca-app-pub-3940256099942544/6300978111',
  ios: 'ca-app-pub-3940256099942544/2934735716',
} as const;

/** 운영 AdMob 광고 단위(배너, 크기는 칸이 정한다). 공개값이다. */
export const PRODUCTION_BANNER_UNITS: Record<AdPhase, { android: string; ios: string }> = {
  browse: {
    android: 'ca-app-pub-9577213564323927/4474393553',
    ios: 'ca-app-pub-9577213564323927/1716368279',
  },
  practice: {
    android: 'ca-app-pub-9577213564323927/9961604084',
    ios: 'ca-app-pub-9577213564323927/7335440742',
  },
  community: {
    android: 'ca-app-pub-9577213564323927/3029449947',
    ios: 'ca-app-pub-9577213564323927/7192056232',
  },
};

/** 칸의 AdMob 광고 단위. 운영 API 를 보는 빌드만 실제 단위를 쓰고, 나머지는 Google 테스트 단위다. */
export function bannerUnitFor(
  slot: AdSlotKey,
  platform: 'ios' | 'android',
  apiUrl: string | undefined,
): string {
  if (!isProductionApiUrl(apiUrl)) return TEST_BANNER_UNIT[platform];
  return PRODUCTION_BANNER_UNITS[AD_SLOTS[slot].phase][platform];
}

/** 전면 칸(SOMA-1085). 서버는 이 칸에 NETWORK(AdMob 전면) 아니면 NONE 만 준다. */
export const FULL_SCREEN_SLOTS = ['analyzing_wait_full', 'script_parse_full', 'reading_done_full'] as const;
export type FullScreenSlotKey = (typeof FULL_SCREEN_SLOTS)[number];

/** Google 공식 테스트 전면 광고 단위. 개발·dev 빌드는 늘 이것만 쓴다. */
export const TEST_INTERSTITIAL_UNIT = {
  android: 'ca-app-pub-3940256099942544/1033173712',
  ios: 'ca-app-pub-3940256099942544/4411468910',
} as const;

/**
 * 운영 AdMob 전면 광고 단위(콘솔 이름 「전면 광고」). 비우면 운영 빌드는 전면 광고를 띄우지 않는다.
 * AdMob 앱 설정은 「높은 참여도 광고」 끔(건너뛰기 5초), 계정 설정은 「전면 광고의 건너뛸 수 없는 동영상」 끔으로 둔다.
 */
export const PRODUCTION_INTERSTITIAL_UNITS: { android: string; ios: string } = {
  android: 'ca-app-pub-9577213564323927/8017035783',
  ios: 'ca-app-pub-9577213564323927/1451627437',
};

/** 전면 광고 단위. 운영 API 를 보는 빌드만 실제 단위(없으면 null — 띄우지 않는다), 나머지는 Google 테스트 단위다. */
export function interstitialUnitFor(platform: 'ios' | 'android', apiUrl: string | undefined): string | null {
  if (!isProductionApiUrl(apiUrl)) return TEST_INTERSTITIAL_UNIT[platform];
  return PRODUCTION_INTERSTITIAL_UNITS[platform] || null;
}

/** 같은 사람에게 전면 광고는 3분에 한 번까지(11/19 수익 모델 확정). */
export const FULL_SCREEN_GAP_MS = 3 * 60_000;

/**
 * 전면 광고를 띄울지 — 서버가 NETWORK 를 줬고(무료·첫 연습 뒤·칸 켜짐), 첫 사용자로 확인되지 않았고, 3분 안에 띄운 적이 없을 때.
 * firstTime 은 화면에 들어왔을 때(연습을 시작할 때) 값을 넘긴다 — 첫 리딩을 막 끝낸 순간에는 이미 'practiced' 로 바뀌어 있다.
 */
export function fullScreenAllowed(input: {
  pick: AdSlotPick | null;
  firstTime: 'unknown' | 'first' | 'practiced';
  lastShownAt: number | null;
  now: number;
}): boolean {
  if (!input.pick || input.pick.kind !== 'NETWORK') return false;
  if (input.firstTime === 'first') return false;
  return input.lastShownAt === null || input.now - input.lastShownAt >= FULL_SCREEN_GAP_MS;
}

/**
 * 칸을 그릴지 앱에서 먼저 거른다. 첫 사용자(첫 연습 전)로 확인됐으면 서버에 묻지 않고 비운다 —
 * 서버도 같은 기준으로 NONE 을 주지만, 자리를 잡았다가 접히는 것을 막는다.
 */
export function shouldRequestSlot(firstTime: 'unknown' | 'first' | 'practiced'): boolean {
  return firstTime !== 'first';
}

/** 앱 밖에서 열 수 있는 http(s) 주소인가. */
export function isHttpLink(url: string | null | undefined): url is string {
  return !!url && /^https?:\/\/\S+$/i.test(url);
}

/** 서버가 고른 결과가 그릴 수 있는 모양인가. 모르는 kind·이미지 없는 DIRECT 는 그리지 않는다. */
export function renderableKind(pick: AdSlotPick | null, options: { korean?: boolean } = {}): AdKind {
  if (!pick) return 'NONE';
  if (pick.kind === 'NETWORK') return 'NETWORK';
  // 직접·우리 앱 광고 그림과 글은 한국어로만 만든다. 영어로 쓰는 사람에게는 그 칸을 AdMob 으로 채운다 —
  // AdMob 은 기기 언어·지역에 맞는 광고를 보낸다(11/3 폰 QA: 영어 기기에 한국어 Pro 안내가 떴다).
  if (options.korean === false && (pick.kind === 'DIRECT' || pick.kind === 'HOUSE')) return 'NETWORK';
  if (pick.kind === 'DIRECT') return pick.ad?.image_url && isHttpLink(pick.ad.link_url) ? 'DIRECT' : 'NONE';
  if (pick.kind === 'HOUSE') {
    if (!pick.ad?.app_path?.startsWith('/')) return 'NONE';
    return pick.ad.image_url || pick.ad.headline ? 'HOUSE' : 'NONE';
  }
  return 'NONE';
}
