/**
 * 암기 모드의 가림(reading.memorization). 가리고 연습은 본문을 다 가리고, 빈칸 연습은 둘째·넷째… 어절을 가리고,
 * 첫 글자는 가린 어절의 첫 글자를 남긴다. 듣고 따라 하기는 재생하는 동안 본문을 가린다. 가림은 같은 대사에서
 * 언제나 같다(무작위 없음). 괄호 지문은 가림과 대조 대상에서 뺀다.
 */

export type MemoMode = "hidden" | "blanks" | "initials" | "listen";

export const MEMO_MODES: { value: MemoMode; label: string }[] = [
  { value: "hidden", label: "가리고 연습" },
  { value: "blanks", label: "빈칸 연습" },
  { value: "initials", label: "첫 글자" },
  { value: "listen", label: "듣고 따라 하기" },
];

export interface MaskToken {
  kind: "word" | "direction";
  text: string;
  masked: boolean;
  /** 가려진 어절에서 보여 주는 글자(첫 글자 힌트). 가리지 않았으면 text 그대로. */
  shown: string;
}

const DIRECTION_RE = /^[(（\[【][^)）\]】]*[)）\]】]$/;

export function maskTokens(text: string, mode: MemoMode, options: { hint?: boolean } = {}): MaskToken[] {
  const pieces = text.split(/\s+/).filter(Boolean);
  const showInitial = mode === "initials" || options.hint === true;
  let wordIndex = 0;
  return pieces.map((piece) => {
    if (DIRECTION_RE.test(piece)) return { kind: "direction", text: piece, masked: false, shown: piece };
    const i = wordIndex++;
    const masked = mode === "blanks" || mode === "initials" ? i % 2 === 1 : true;
    const shown = !masked ? piece : showInitial ? Array.from(piece)[0] ?? "" : "";
    return { kind: "word", text: piece, masked, shown };
  });
}

/** 글자 하나를 밑줄 하나로 — 화면 밖(테스트·문구)에서 쓰는 표현 */
export function renderMasked(text: string, mode: MemoMode, options: { hint?: boolean } = {}): string {
  return maskTokens(text, mode, options)
    .map((t) => (t.masked ? t.shown + "_".repeat(Math.max(0, Array.from(t.text).length - Array.from(t.shown).length)) : t.text))
    .join(" ");
}
