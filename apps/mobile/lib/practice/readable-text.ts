/**
 * 자유 입력칸 공용 허용 글자 범위(코칭 답·댓글·신고 메모·이름 등. SOMA-922 에서 공용으로 쓴다). 서버 ActorTextCharset 과 같은 범위다 — 범위 밖 글자가 하나라도 있으면 보내지 않는다.
 * 10/27 운영에 글자마다 결합 기호를 쌓은 글(자고 텍스트)이 들어와서 생겼다. 영문·숫자·기본 기호(ASCII), 한글,
 * 자주 쓰는 문장부호, 이모지만 허용하고 결합 기호·보이지 않는 글자·제어 문자·그 밖의 문자는 막는다.
 */
const RANGES: readonly (readonly [number, number])[] = [
  [0x20, 0x7e], // ASCII 영문·숫자·기본 기호
  [0xac00, 0xd7a3], // 한글 완성형
  [0x1100, 0x11ff], // 한글 자모(분해형)
  [0x3130, 0x318f], // 한글 호환 자모(ㅋㅋ, ㅠㅠ)
  [0x2010, 0x2027], // – — ‘ ’ “ ” • …
  [0x2030, 0x205e], // ‰ ′ ※ ‼ ⁉
  [0x20a0, 0x20cf], // ₩ €
  [0x2100, 0x23ff], // ℃ ™ 화살표 ⌚ ⏰
  [0x2460, 0x27bf], // ① ■ ★ ♥ ✔
  [0x2b00, 0x2bff], // ⭐ ⬆
  [0x3000, 0x303f], // 「」『』、。〜
  [0x3200, 0x32ff], // ㈜ ㉠
  [0xff01, 0xff60], // 전각 ！？～
  [0xffe0, 0xffe6], // ￦
  [0x1f000, 0x1faff], // 이모지·국기·피부색
];

const JOINERS = new Set([0x200d, 0xfe0e, 0xfe0f, 0x20e3]);

function allowed(c: number, previous: number): boolean {
  if (c === 0x0a || c === 0x0d || c === 0x09) return true;
  if (c >= 0xa0 && c <= 0xff && c !== 0xad) return true; // · × é 같은 라틴-1 (보이지 않는 하이픈 제외)
  if (RANGES.some(([from, to]) => c >= from && c <= to)) return true;
  // 이모지를 잇는 글자는 앞 글자에 붙을 때만(❤️‍🔥처럼 FE0F 뒤 200D는 된다). 이것만 겹쳐 쌓는 것은 막는다.
  if (c === 0x200d || c === 0xfe0e || c === 0xfe0f) return previous >= 0 && previous !== c && previous !== 0x200d && previous !== 0x20e3;
  if (c === 0x20e3) return previous === 0xfe0f || (previous >= 0x30 && previous <= 0x39) || previous === 0x23 || previous === 0x2a;
  return false;
}

/** 허용 범위 글자로만 되어 있고 보이는 글자가 하나 이상인지. 빈 글은 false. */
export function readableText(text: string): boolean {
  let visible = false;
  let previous = -1;
  for (const ch of text.normalize('NFC')) {
    const c = ch.codePointAt(0) ?? 0;
    if (!allowed(c, previous)) return false;
    if (!JOINERS.has(c) && !/\s/u.test(ch) && c !== 0xa0 && c !== 0x3000) visible = true;
    previous = c;
  }
  return visible;
}

/** 입력칸 아래에 "읽을 수 없는 글자" 안내를 띄울지. 비어 있으면 띄우지 않는다. */
export function hasUnreadableText(text: string): boolean {
  return text.trim().length > 0 && !readableText(text.trim());
}

/**
 * 입력칸에 들어오는 글에서 허용 범위 밖 글자를 뺀다. 아무것도 빠지지 않으면 받은 문자열을 그대로 돌려준다
 * (한글 조합 중인 입력값을 건드리지 않으려고 NFC 정규화는 하지 않는다 — 분해형 é 는 e 만 남는다).
 */
export function stripUnreadable(text: string): string {
  let out = '';
  let previous = -1;
  let removed = false;
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0;
    if (allowed(c, previous)) {
      out += ch;
      previous = c;
    } else {
      removed = true;
    }
  }
  return removed ? out : text;
}

/**
 * 입력 규칙 두 가지.
 * - strict: 위 허용 범위 안의 글자만(코칭·댓글·신고·이름 등 짧은 자유 입력).
 * - loose: 대본 글처럼 한국어·영어·일본어·중국어 등 여러 문자가 정상으로 들어오는 곳. 문자 종류는 막지 않고
 *   결합 기호를 {@link MAX_COMBINING_RUN}개 넘게 쌓는 것과 제어 문자만 뺀다. 서버 InputCharset.stacked 와 같다.
 */
export type InputCharsetMode = 'strict' | 'loose';

export const MAX_COMBINING_RUN = 4;

const COMBINING = /[\p{Mn}\p{Me}]/u;

function stackedMark(ch: string, c: number): boolean {
  return COMBINING.test(ch) || c === 0x200d || c === 0xfe0e || c === 0xfe0f;
}

/** 대본용: 결합 기호 연속 상한 초과분과 제어 문자(줄바꿈·탭 제외)를 뺀다. 뺀 게 없으면 받은 문자열 그대로. */
export function stripStacked(text: string): string {
  let out = '';
  let run = 0;
  let removed = false;
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0;
    if (/\p{Cc}/u.test(ch) && c !== 0x0a && c !== 0x0d && c !== 0x09) {
      removed = true;
      continue;
    }
    if (stackedMark(ch, c)) {
      if (++run > MAX_COMBINING_RUN) {
        removed = true;
        continue;
      }
    } else {
      run = 0;
    }
    out += ch;
  }
  return removed ? out : text;
}

/** 입력칸에 들어오는 글을 규칙에 맞게 고른다. 아무것도 빠지지 않으면 받은 문자열 그대로. */
export function sanitizeInput(text: string, mode: InputCharsetMode = 'strict'): string {
  return mode === 'loose' ? stripStacked(text) : stripUnreadable(text);
}
