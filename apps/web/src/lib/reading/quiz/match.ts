/**
 * 암기 대조 — 말한 것을 글자로 바꾼 결과를 대본 텍스트와만 맞춰본다.
 * 오디오 신호를 보지 않는다. 자모 단위 편집거리 유사도로 맞춰보기한다.
 */

const CHO = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";
const JUNG = "ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ";
const JONG = ["", "ㄱ", "ㄲ", "ㄳ", "ㄴ", "ㄵ", "ㄶ", "ㄷ", "ㄹ", "ㄺ", "ㄻ", "ㄼ", "ㄽ", "ㄾ", "ㄿ", "ㅀ", "ㅁ", "ㅂ", "ㅄ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];

export function toJamo(s: string): string {
  let out = "";
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

export function normalizeForMatch(s: string): string {
  return s
    .replace(/[(（\[【][^)）\]】]*[)）\]】]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "")
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

/** read.acttub.com 실측 통과선: 느슨하게 0.72 */
export const PASS_THRESHOLD = 0.72;

export interface CompareResult {
  pass: boolean;
  closeness: number;
}

export function compare(said: string, target: string): CompareResult {
  if (!normalizeForMatch(said)) return { pass: false, closeness: 0 };
  const closeness = similarity(said, target);
  return { pass: closeness >= PASS_THRESHOLD, closeness };
}

/** 완주 요약용 — 통과한 줄 비율. 진행 맞춰보기과 분리해 둔다. */
export function accuracy(results: CompareResult[]): number {
  if (!results.length) return 0;
  return results.filter((r) => r.pass).length / results.length;
}
