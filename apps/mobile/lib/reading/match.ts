/**
 * 글자 대조(reading.memorization · reading.session) — 말한 것을 글자로 바꾼 결과를 대본 원문과만 맞춰본다.
 * 웹 `quiz/match.ts` 와 같은 규칙이다. 결과는 통과·미달·인식 없음·너무 김 넷이고 점수를 화면에 내지 않는다.
 */

const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const JUNG = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ';
const JONG = ['', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];

export function toJamo(s: string): string {
  let out = '';
  for (const ch of s) {
    const code = ch.charCodeAt(0);
    if (code < 0xac00 || code > 0xd7a3) {
      out += ch;
      continue;
    }
    const i = code - 0xac00;
    out += CHO[Math.floor(i / 588)] + JUNG[Math.floor((i % 588) / 28)] + JONG[i % 28];
  }
  return out;
}

/** 괄호 안 제거, 문자·숫자만, 소문자. */
export function normalizeForMatch(s: string): string {
  return s
    .replace(/[(（\[【][^)）\]】]*[)）\]】]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .toLowerCase();
}

function levenshtein(a: string, b: string): number {
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** 0~1. 자모 단위 편집거리 기반 */
export function similarity(said: string, target: string): number {
  const a = toJamo(normalizeForMatch(said));
  const b = toJamo(normalizeForMatch(target));
  if (!a.length && !b.length) return 1;
  const d = levenshtein(a, b);
  return 1 - d / Math.max(a.length, b.length);
}

/** 통과선. 기기 상수다(서버에 저장하지 않는다). */
export const PASS_THRESHOLD = 0.72;

/** 대조 입력 상한(원문·말한 것 각각). 넘으면 대조하지 않고 수동 진행을 준다 — 대조는 길이의 곱에 비례한다. */
export const MATCH_INPUT_MAX = 1000;

export type LineMatch =
  | { kind: 'pass'; closeness: number }
  | { kind: 'miss'; closeness: number }
  /** 인식 불가·무발화. 미달로 세지 않는다. */
  | { kind: 'no_speech' }
  /** 한도 초과. 대조하지 않고 미달로 기록하지 않는다. */
  | { kind: 'too_long' };

function codePoints(s: string): number {
  return s.length - (s.match(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g)?.length ?? 0);
}

export function compareLine(said: string, target: string): LineMatch {
  if (codePoints(said) > MATCH_INPUT_MAX || codePoints(target) > MATCH_INPUT_MAX) return { kind: 'too_long' };
  if (!normalizeForMatch(said)) return { kind: 'no_speech' };
  const closeness = similarity(said, target);
  return closeness >= PASS_THRESHOLD ? { kind: 'pass', closeness } : { kind: 'miss', closeness };
}

const squash = (s: string) => s.replace(/\s+/g, '');

/**
 * 인식 결과 항목들을 한 문장으로 합친다. 인식기는 이어지는 조각을 주기도 하고 처음부터의 누적을 주기도
 * 한다 — 지금까지 합친 것이 새 항목의 앞부분이면 갈아 끼우고, 새 항목이 앞부분이면 버리고, 아니면 이어 붙인다.
 */
export function mergeTranscripts(parts: string[]): string {
  let acc = '';
  for (const raw of parts) {
    const t = raw.trim();
    if (!t) continue;
    const a = squash(acc);
    const b = squash(t);
    if (!a || b.startsWith(a)) acc = t;
    else if (a.startsWith(b)) continue;
    else acc = `${acc} ${t}`;
  }
  return acc.trim();
}
