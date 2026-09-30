/**
 * Firebase Crashlytics 초기화 래퍼 — 버전별 크래시 스택을 모은다.
 *
 * 네이티브 크래시는 SDK 가 스스로 모으고, JS 의 처리되지 않은 예외는 이 모듈을 불러오는 순간 붙는
 * 핸들러가 보낸다. 개발 빌드와 운영 빌드가 같은 앱 버전을 쓰므로 `api_env` 속성으로 가른다.
 *
 * ⚠️ lib/meta-events.ts 와 같은 규칙 — 네이티브 모듈이 없는 환경(Node 테스트·옛 빌드)에서 조용히
 * no-op 이 되도록 최상위 import 없이 함수 안 require 로만 닿는다.
 */
const API_URL = process.env.EXPO_PUBLIC_API_URL;
const PRODUCTION_API_URL = 'https://acttub.com';

/** 크래시에 붙일 환경 이름. */
export function crashEnvironment(apiUrl: string | undefined): 'prod' | 'dev' {
  return apiUrl === PRODUCTION_API_URL ? 'prod' : 'dev';
}

export async function initCrashlytics(): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getCrashlytics, setAttribute } = require('@react-native-firebase/crashlytics');
    await setAttribute(getCrashlytics(), 'api_env', crashEnvironment(API_URL));
  } catch {
    // 모듈이 없는 빌드 — 크래시 수집 없이 간다.
  }
}
