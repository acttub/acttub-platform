import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from '../locales/en.ts';
import ko from '../locales/ko.ts';

/**
 * 앱 현지화 (SOMA-461).
 * - 기기 언어가 한국어면 한국어, 그 외에는 전부 영어를 보여준다 — 한국어를 모르는
 *   사용자에게 한국어를 들이미는 것보다 영어가 안전한 기본값이다.
 * - expo-localization 은 네이티브 모듈이라 구 빌드·웹에서는 없을 수 있다 —
 *   못 읽으면 한국어(기존 동작)로 간다.
 * - 서버가 만들어 주는 문장(코치 대화, 연습 노트 본문)은 이 범위 밖이다.
 */
function deviceLanguage(): 'ko' | 'en' {
  try {
    const localization = require('expo-localization') as typeof import('expo-localization');
    const code = localization.getLocales()[0]?.languageCode;
    if (!code) return 'ko';
    return code === 'ko' ? 'ko' : 'en';
  } catch {
    return 'ko';
  }
}

void i18n.use(initReactI18next).init({
  resources: {
    ko: { translation: ko },
    en: { translation: en },
  },
  lng: deviceLanguage(),
  fallbackLng: 'ko',
  interpolation: { escapeValue: false },
  returnEmptyString: false,
});

export default i18n;

/** 날짜 포맷에 쓸 로케일 — 표시 언어와 같이 간다. */
export function dateLocale(): string {
  return i18n.language === 'ko' ? 'ko-KR' : 'en-US';
}

/** 화면 밖(훅을 못 쓰는 모듈)에서 문구를 꺼낼 때 쓴다. */
export function translate(key: string, options?: Record<string, unknown>): string {
  return i18n.t(key, options);
}

/** 배열 리소스(단계 안내 등)를 꺼낸다. 없으면 빈 배열. */
export function translateList(key: string): string[] {
  const value = i18n.t(key, { returnObjects: true }) as unknown;
  return Array.isArray(value) ? (value as string[]) : [];
}
