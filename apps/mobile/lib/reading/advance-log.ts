import { isProductionApiUrl } from '../api-env.ts';

/**
 * 리딩 자동 넘김 판정 기록(SOMA-1037). dev API 빌드는 PostHog·Firebase 로 보내지 않아서, 폰에서 안 넘어갈 때 원인을
 * 볼 길이 없었다. dev API 빌드에서만 폰 로그(adb logcat 의 ReactNativeJS)에 남긴다. 운영 빌드와 테스트에서는 아무것도 하지 않는다.
 * 받아쓴 글 원문은 남기지 않는다 — 글자 수와 일치율만 적는다.
 */
const enabled = !isProductionApiUrl(process.env.EXPO_PUBLIC_API_URL) && !process.env.JEST_WORKER_ID;

export function logAdvance(stage: string, data: Record<string, unknown> = {}): void {
  if (!enabled) return;
  console.log('[advance]', stage, JSON.stringify(data));
}
