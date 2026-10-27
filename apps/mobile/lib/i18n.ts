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

/**
 * 설정에서 고른 표시 언어(SOMA-827 후속). 'system' 이면 기기 언어를 따른다.
 * 표시 언어는 앱이 켜질 때 한 번 정한다 — 화면 곳곳이 모듈을 불러올 때 문구를 만들어 두므로, 바꾼 언어는 앱을 다시 켜야 적용된다.
 * 동기로 읽어야 해서 SecureStore 의 getItem(동기)을 쓴다. 기기 설정이라 로그아웃·탈퇴로 지우지 않는다.
 */
export type LanguagePreference = 'system' | 'ko' | 'en';
const LANGUAGE_KEY = 'acttub.language';

function storedPreference(): LanguagePreference {
  try {
    const store = require('expo-secure-store') as { getItem(key: string): string | null };
    const value = store.getItem(LANGUAGE_KEY);
    return value === 'ko' || value === 'en' ? value : 'system';
  } catch {
    return 'system';
  }
}

let preference = storedPreference();
let language = preference === 'system' ? deviceLanguage() : preference;
const languageListeners = new Set<() => void>();

/**
 * 설정에서 언어를 바꾸면 부른다 — 앱 뿌리가 화면을 다시 그려 껐다 켜지 않아도 바로 바뀐다(10/28 폰 확인: 다시 켜야 바뀌었다).
 */
export function onLanguageChange(listener: () => void): () => void {
  languageListeners.add(listener);
  return () => {
    languageListeners.delete(listener);
  };
}

/** 이번 실행이 쓰는 설정 값(켤 때 읽은 것). */
export function languagePreference(): LanguagePreference {
  return preference;
}

/** 다음에 켤 때 쓸 언어를 저장한다. 지금 켜진 앱의 말은 바뀌지 않는다. */
export async function saveLanguagePreference(next: LanguagePreference): Promise<void> {
  const store = require('expo-secure-store') as {
    setItemAsync(key: string, value: string): Promise<void>;
    deleteItemAsync(key: string): Promise<void>;
  };
  if (next === 'system') await store.deleteItemAsync(LANGUAGE_KEY);
  else await store.setItemAsync(LANGUAGE_KEY, next);
  preference = next;
  language = next === 'system' ? deviceLanguage() : next;
  for (const listener of languageListeners) listener();
}
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

/** 지금 쓰는 말. 서버에 어느 말로 답할지 알릴 때, 한국 전용 기능을 가릴 때 쓴다. */
export function currentLanguage(): 'ko' | 'en' {
  return language;
}

/** 한국어로 쓰는 사람인가 — 연기 입시처럼 한국에서만 쓸모 있는 것에 쓴다. */
export function isKorean(): boolean {
  return language === 'ko';
}

/** 받아쓰기·음성 합성에 넘길 말 코드. */
export function speechLocale(): string {
  return language === 'ko' ? 'ko-KR' : 'en-US';
}
