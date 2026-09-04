/**
 * Meta(Facebook) SDK 초기화 래퍼 — 앱 설치 광고용 App Events 수집(SOMA-481).
 *
 * 네이티브 모듈(react-native-fbsdk-next)은 개발 빌드에서만 존재하므로 Expo Go·웹·Node(테스트)
 * 에서는 require가 실패한다. lib/analytics.ts와 같은 방식으로 전부 try 가드에 넣어 그런 환경에서는
 * 조용히 no-op이 되게 한다.
 *
 * ⚠️ 이 파일은 CI(`node --test tests/*.test.mjs`)에서 타입 스트리핑으로 그대로 import된다.
 * 최상위에 react-native·expo 모듈을 import하면 CI가 깨진다 — 네이티브 접근은 반드시 함수 안 require로.
 *
 * 초기화 순서는 react-native-fbsdk-next 문서의 "Enabling Auto App Installs in Expo"를 따른다.
 *   ATT 요청 → Settings.initializeSDK() → 허용 시 setAdvertiserTrackingEnabled(true)
 * app.json에서 `isAutoInitEnabled: false`로 둔 이유가 여기 있다. 자동 초기화를 켜두면 iOS에서
 * ATT 답을 받기 전에 SDK가 붙고, 아래 운영 빌드 게이트도 무력화된다.
 */

// Metro는 `process.env.EXPO_PUBLIC_*` 리터럴만 빌드 시점에 치환한다.
// 변수로 우회해서 읽으면 값이 사라지므로 여기서 리터럴 그대로 한 번 읽어 순수 함수에 넘긴다.
const API_URL = process.env.EXPO_PUBLIC_API_URL;
const META_EVENTS_OVERRIDE = process.env.EXPO_PUBLIC_META_EVENTS;

/**
 * 운영 API를 보는 빌드에서만 이벤트를 보낸다(lib/analytics.ts와 같은 규칙, SOMA-439).
 * 개발 빌드가 같은 Meta App ID로 이벤트를 쏘면 설치 광고 최적화 데이터가 오염된다.
 * ⚠️ eas.json의 production/preview-prod 프로필 EXPO_PUBLIC_API_URL과 같은 값이어야 한다.
 */
const PRODUCTION_API_URL = 'https://acttub.com';
const DEFAULT_API_URL = 'https://dev.acttub.com';

/**
 * 운영 빌드면 전송한다. `EXPO_PUBLIC_META_EVENTS=1`은 검증용 탈출구 —
 * dev API를 보는 내부 빌드로 Events Manager 유입을 확인할 때만 쓴다.
 */
export function metaEventsEnabled(
  apiUrl: string | undefined,
  override: string | undefined,
): boolean {
  if ((override ?? '').trim() === '1') return true;
  const normalized = (apiUrl ?? DEFAULT_API_URL)
    .trim()
    .replace(/\/+$/, '')
    .toLowerCase();
  return normalized === PRODUCTION_API_URL;
}

export type TrackingDecision = {
  /** Meta SDK를 초기화할지 */
  initialize: boolean;
  /** 광고 식별자(IDFA/AAID) 수집을 허용할지 */
  advertiserTracking: boolean;
};

/**
 * 전송 게이트와 ATT 응답을 합쳐 무엇을 할지 정한다.
 * ATT는 iOS 전용이지만 expo-tracking-transparency가 Android·웹에서 항상 granted를 돌려주므로
 * 플랫폼 분기 없이 같은 경로를 탄다.
 */
export function resolveTrackingDecision(input: {
  enabled: boolean;
  granted: boolean;
}): TrackingDecision {
  if (!input.enabled) {
    return { initialize: false, advertiserTracking: false };
  }
  return { initialize: true, advertiserTracking: input.granted };
}

let started = false;

/**
 * 앱 기동 시 한 번 호출한다. ATT 팝업은 앱이 활성 상태여야 뜨므로 스플래시 이후에 부른다.
 * 실패는 전부 삼킨다 — 광고 계측이 앱 흐름을 막지 않는다.
 */
export async function initMetaSdk(): Promise<void> {
  if (started) return;
  started = true;

  const enabled = metaEventsEnabled(API_URL, META_EVENTS_OVERRIDE);
  if (!enabled) return;

  let granted = false;
  try {
    const tracking = require('expo-tracking-transparency');
    const response = await tracking.requestTrackingPermissionsAsync();
    granted = response?.status === 'granted';
  } catch {
    // 모듈 없음 또는 요청 실패 — 광고 식별자 없이 진행한다
    granted = false;
  }

  const decision = resolveTrackingDecision({ enabled, granted });
  if (!decision.initialize) return;

  try {
    const { Settings } = require('react-native-fbsdk-next');
    Settings.initializeSDK();
    await Settings.setAdvertiserTrackingEnabled(decision.advertiserTracking);
  } catch {
    // 네이티브 모듈 없음(Expo Go·웹) — no-op
  }
}
