/**
 * Firebase Analytics 래퍼.
 * 운영 지표 오염 방지를 위해 운영 API 빌드에서만 이벤트를 전송한다(SOMA-439).
 *
 * 네이티브 모듈(@react-native-firebase/*)은 개발 빌드(EAS/expo run:android)에서만 존재하고,
 * google-services.json이 배치돼 초기화가 성공해야 실제로 이벤트가 전송된다.
 * Expo Go·웹·설정 파일 미배치 환경에서는 require/초기화가 실패하므로, 모든 API를
 * try/가드로 감싸 그런 환경에서는 조용히 no-op이 되게 한다(앱 크래시 방지).
 *
 * 이벤트 이름은 GA4 규칙: snake_case, 40자 이내. 커스텀 파라미터도 snake_case.
 *
 * iOS/Android 모두 Firebase 네이티브 모듈을 포함한다(2026-07-23부터). iOS는 useFrameworks(static)
 * 컴파일 충돌을 $RNFirebaseAsStaticFramework=true(plugins/with-rnfirebase-static)로 해결.
 * 네이티브 모듈이 없거나 초기화 실패한 환경(Expo Go·웹)은 아래 try 가드로 조용히 no-op이 된다.
 */
import { isProductionApiUrl } from './api-env.ts';

let resolved = false;
let instance: unknown = null;
let mod: any = null;

function getAnalytics(): unknown {
  if (resolved) return instance;
  resolved = true;
  // 운영 API를 보는 빌드에서만 이벤트를 보낸다(lib/api-env.ts).
  if (!isProductionApiUrl(process.env.EXPO_PUBLIC_API_URL)) return instance;
  try {
    mod = require('@react-native-firebase/analytics');
    const factory = mod.getAnalytics ?? mod.default;
    instance = factory();
  } catch {
    // 네이티브 모듈 없음 또는 Firebase 미초기화 — 이후 호출은 전부 no-op
    instance = null;
    mod = null;
  }
  return instance;
}

/** 커스텀/표준 이벤트 로깅. 실패는 삼킨다(분석은 앱 흐름을 막지 않는다). */
export async function logEvent(
  name: string,
  params?: Record<string, string | number | boolean>,
): Promise<void> {
  const a = getAnalytics();
  if (!a || !mod) return;
  try {
    await mod.logEvent(a, name, params);
  } catch {
    // 무시
  }
}

/**
 * 화면 조회 이벤트. GA4 표준 'screen_view' 이벤트로 보낸다.
 * (rnfirebase v22+에서 logScreenView는 deprecated — logEvent로 통합)
 */
export async function logScreenView(screenName: string): Promise<void> {
  await logEvent('screen_view', {
    screen_name: screenName,
    screen_class: screenName,
  });
}

/**
 * 가입을 마친 회원의 회사 내부 회원 식별 번호를 GA 사용자 ID로 붙인다. 로그아웃·탈퇴면 `null` 로 지운다.
 * 화면·동작 기록을 계정과 이어, 가입한 사람이 어느 화면에서 멈추는지 보기 위해서다(SOMA-588).
 * 이름·이메일·광고 정보는 보내지 않는다 — Airbridge 와 같은 내부 번호(me.id)만 쓴다.
 */
export async function setAnalyticsUserId(userId: string | null): Promise<void> {
  const a = getAnalytics();
  if (!a || !mod) return;
  try {
    await mod.setUserId(a, userId);
  } catch {
    // 무시
  }
}
