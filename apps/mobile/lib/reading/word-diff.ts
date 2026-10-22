/**
 * 원문과 다르게 말한 어절(reading.session) — 리딩 중 가린 내 대사를 말한 뒤 원문을 펼칠 때 표시한다(SOMA-785).
 * 띄어쓰기·문장부호·괄호 안 지시·낱자모(ㅋㅋ·ㅎㅎ)를 빼고 글자 단위로 맞춰 본 뒤(최장 공통 부분열), 맞지 않는 글자가 있는
 * 원문 어절만 표시한다. 더한 말은 원문에 자리가 없어 표시하지 않는다. 완료 화면의 표시를 정하는 서버 WordDiff 와 같은 규칙이다.
 */
export type DiffWord = { text: string; differs: boolean };

/** 서버 LineMatch.INPUT_MAX 와 같다 — 넘으면 표시하지 않는다. */
const INPUT_MAX = 1000;
const OPEN = /[(（[【]/;
const CLOSE = /[)）\]】]/;
const COMPARABLE = /[\p{L}\p{N}]/u;
const JAMO = /[ㄱ-ㆎ]/;

const comparable = (c: string) => COMPARABLE.test(c) && !JAMO.test(c);

export function diffWords(target: string, said: string): DiffWord[] {
  const words = target.split(/\s+/).filter(Boolean);
  const units: { word: number; ch: string }[] = [];
  let depth = 0;
  words.forEach((w, word) => {
    for (const c of w) {
      if (OPEN.test(c)) depth += 1;
      else if (CLOSE.test(c)) depth = Math.max(0, depth - 1);
      else if (depth === 0 && comparable(c)) units.push({ word, ch: c.toLowerCase() });
    }
  });
  const spoken = [...said].filter(comparable).map((c) => c.toLowerCase());
  if (units.length > INPUT_MAX || spoken.length > INPUT_MAX) return words.map((text) => ({ text, differs: false }));

  const n = units.length;
  const m = spoken.length;
  const lcs = new Uint16Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * (m + 1) + j] =
        units[i].ch === spoken[j] ? lcs[(i + 1) * (m + 1) + j + 1] + 1 : Math.max(lcs[(i + 1) * (m + 1) + j], lcs[i * (m + 1) + j + 1]);
    }
  }
  const differs = new Array<boolean>(words.length).fill(false);
  let i = 0;
  let j = 0;
  while (i < n) {
    if (j < m && units[i].ch === spoken[j]) {
      i += 1;
      j += 1;
    } else if (j < m && lcs[i * (m + 1) + j + 1] >= lcs[(i + 1) * (m + 1) + j]) {
      j += 1;
    } else {
      differs[units[i].word] = true;
      i += 1;
    }
  }
  return words.map((text, w) => ({ text, differs: differs[w] }));
}
