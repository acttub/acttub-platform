import en from '../locales/en.ts';
import ko from '../locales/ko.ts';

/**
 * 앱 현지화 (SOMA-449).
 * - 기기 언어가 한국어면 한국어, 그 외에는 전부 영어를 보여준다 — 한국어를 모르는
 *   사용자에게 한국어를 들이미는 것보다 영어가 안전한 기본값이다.
 * - expo-localization 은 네이티브 모듈이라 구 빌드·웹·node 테스트에는 없다 —
 *   못 읽으면 한국어(기존 동작)로 간다.
 * - i18next 를 쓰지 않는 이유: CI 의 mobile 잡은 npm 설치 없이 순수 node 로
 *   테스트를 돌린다. 우리가 필요한 건 키 조회와 {{변수}} 치환뿐이라 직접 든다.
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

const language = deviceLanguage();
const tables: Record<'ko' | 'en', object> = { ko, en };

/** 'a.b.c' 키로 중첩 객체를 내려간다. 키 조각에 점은 못 쓴다('그 외'는 괜찮다). */
function walk(table: object, key: string): unknown {
  return key
    .split('.')
    .reduce<unknown>(
      (node, part) => (node == null ? undefined : (node as Record<string, unknown>)[part]),
      table,
    );
}

function lookup(key: string): unknown {
  const value = walk(tables[language], key);
  // 번역이 빠졌으면 한국어(정본)로 폴백 — 빈 화면보다 낫다.
  return value !== undefined ? value : walk(tables.ko, key);
}

/** 문구를 꺼낸다. `{{name}}` 자리에 options[name]을 채운다. 없는 키는 키 그대로. */
export function translate(key: string, options?: Record<string, unknown>): string {
  const value = lookup(key);
  if (typeof value !== 'string') return key;
  if (!options) return value;
  return value.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
    options[name] === undefined || options[name] === null ? match : String(options[name]),
  );
}

/** 배열 리소스(단계 안내 등)를 꺼낸다. 없으면 빈 배열. */
export function translateList(key: string): string[] {
  const value = lookup(key);
  return Array.isArray(value) ? (value as string[]) : [];
}

/** 날짜 포맷에 쓸 로케일 — 표시 언어와 같이 간다. */
export function dateLocale(): string {
  return language === 'ko' ? 'ko-KR' : 'en-US';
}
