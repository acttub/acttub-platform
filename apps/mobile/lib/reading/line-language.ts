/**
 * 대사 줄의 말 (reading.script 「줄별 말」, SOMA-751).
 *
 * <p>서버가 나누기 뒤 외국 글자가 든 대사마다 말(lang)과 상대역 목소리가 읽을 글(speech)을 단다. 예: 로마자로 적은
 * 시리아 아랍어 "3anni ana? 안니 아나?" → lang 'ar', speech 는 아랍 문자. 말이 없는 줄(옛 대본·고친 줄·한국어 줄)은
 * 글자로 짐작하고, 짐작할 수 없으면 지금처럼 앱 표시 언어로 읽는다.
 */
import { currentLanguage } from '../i18n.ts';

/** 앱 목소리(Supertonic 3)가 읽는 말. 'na' 는 말을 모를 때 모델이 쓰는 값이다. */
export const VOICE_LANGS = ['en', 'ko', 'ja', 'ar', 'bg', 'cs', 'da', 'de', 'el', 'es', 'et', 'fi', 'fr', 'hi', 'hr', 'hu', 'id', 'it', 'lt', 'lv', 'nl', 'pl', 'pt', 'ro', 'ru', 'sk', 'sl', 'sv', 'tr', 'uk', 'vi'] as const;

/** 받아쓰기·기기 음성에 넘길 지역 코드. 아랍어는 iOS·Android 모두 받는 사우디(ar-SA)로 둔다. */
const LOCALES: Record<string, string> = {
  ko: 'ko-KR', en: 'en-US', ja: 'ja-JP', ar: 'ar-SA', bg: 'bg-BG', cs: 'cs-CZ', da: 'da-DK', de: 'de-DE', el: 'el-GR',
  es: 'es-ES', et: 'et-EE', fi: 'fi-FI', fr: 'fr-FR', hi: 'hi-IN', hr: 'hr-HR', hu: 'hu-HU', id: 'id-ID', it: 'it-IT',
  lt: 'lt-LT', lv: 'lv-LV', nl: 'nl-NL', pl: 'pl-PL', pt: 'pt-BR', ro: 'ro-RO', ru: 'ru-RU', sk: 'sk-SK', sl: 'sl-SI',
  sv: 'sv-SE', tr: 'tr-TR', uk: 'uk-UA', vi: 'vi-VN',
};

export type LanguageLine = { text: string; lang?: string | null; speech?: string | null };

const known = (lang: string | null | undefined): lang is string => !!lang && Object.prototype.hasOwnProperty.call(LOCALES, lang);

/** 글자로 짐작한 말. 한글·아랍·가나·그리스·키릴 문자가 가장 많은 쪽을 고른다. 로마자만 있으면 모른다(null). */
export function guessLanguage(text: string): string | null {
  const body = (text ?? '').replace(/\([^)]*\)|\[[^\]]*\]/g, ' ');
  const counts: Record<string, number> = { ko: 0, ar: 0, ja: 0, el: 0, ru: 0 };
  for (const ch of body) {
    if (/\p{Script=Hangul}/u.test(ch)) counts.ko += 1;
    else if (/\p{Script=Arabic}/u.test(ch)) counts.ar += 1;
    else if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(ch)) counts.ja += 1;
    else if (/\p{Script=Greek}/u.test(ch)) counts.el += 1;
    else if (/\p{Script=Cyrillic}/u.test(ch)) counts.ru += 1;
  }
  const [best, n] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return n > 0 ? best : null;
}

/** 이 줄의 말. 서버 값 → 글자 짐작 → null(앱 표시 언어). */
export function lineLanguage(line: LanguageLine): string | null {
  if (known(line.lang)) return line.lang;
  return guessLanguage(line.speech?.trim() || line.text);
}

/** 상대역 목소리가 읽을 글. 서버가 준 소리 낼 글이 있으면 그것. */
export function speechTextOf(line: LanguageLine): string {
  return line.speech?.trim() || line.text;
}

/** 앱 목소리에 넘길 말. 모르면 앱 표시 언어. */
export function voiceLanguage(lang: string | null): string {
  return known(lang) ? lang : currentLanguage();
}

/** 받아쓰기·기기 음성의 지역 코드. 모르면 앱 표시 언어의 것. */
export function speechLocaleFor(lang: string | null): string {
  return LOCALES[voiceLanguage(lang)] ?? 'en-US';
}

/** 한국어 전용 기능(발음 피드백·빠르기)을 켜도 되는 줄인가. */
export function isKoreanLine(line: LanguageLine): boolean {
  return voiceLanguage(lineLanguage(line)) === 'ko';
}
