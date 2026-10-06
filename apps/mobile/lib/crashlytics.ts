/**
 * Firebase Crashlytics 초기화 래퍼 — 버전별 크래시 스택을 모은다.
 *
 * 네이티브 크래시는 SDK 가 스스로 모으고, JS 의 처리되지 않은 예외는 이 모듈을 불러오는 순간 붙는
 * 핸들러가 보낸다. 개발 빌드와 운영 빌드가 같은 앱 버전을 쓰므로 `api_env` 속성으로 가른다.
 *
 * ⚠️ lib/meta-events.ts 와 같은 규칙 — 네이티브 모듈이 없는 환경(Node 테스트·옛 빌드)에서 조용히
 * no-op 이 되도록 최상위 import 없이 함수 안 require 로만 닿는다.
 */
import { PRODUCTION_API_URL } from './api-env.ts';

const API_URL = process.env.EXPO_PUBLIC_API_URL;

/** 크래시에 붙일 환경 이름. 계측 판정(isProductionApiUrl)과 달리 공백·끝 슬래시를 정리하지 않고 글자 그대로 비교한다. */
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

/** 화면이 처리해 사용자에게는 뭉뚱그려 보인 오류의 원인을 남긴다. */
export function recordHandledError(error: unknown): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getCrashlytics, recordError } = require('@react-native-firebase/crashlytics');
    recordError(getCrashlytics(), error instanceof Error ? error : new Error(String(error)));
  } catch {
    // 모듈이 없는 빌드 — 남기지 않고 간다.
  }
}

/**
 * 지금 화면을 크래시 기록에 남긴다. 메모리 부족처럼 스택만으로는 어디서인지 모르는 크래시가 있어(0.1.2 안드로이드 OOM)
 * 화면이 바뀔 때마다 마지막 화면(속성)과 지나온 화면(로그)을 붙인다. 경로만 남기고 사용자 정보는 넣지 않는다.
 */
export function markScreen(screen: string): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getCrashlytics, log, setAttribute } = require('@react-native-firebase/crashlytics');
    const crashlytics = getCrashlytics();
    void setAttribute(crashlytics, 'screen', screen);
    log(crashlytics, `screen ${screen}`);
  } catch {
    // 모듈이 없는 빌드 — 남기지 않고 간다.
  }
}
