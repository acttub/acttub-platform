/**
 * 원문과 다르게 말한 어절(reading.session) — 완료 화면·전체 보기·회차 상세가 같이 쓴다.
 * 띄어쓰기·문장부호·괄호 안 지시를 빼고 글자 단위로 맞춰 본 뒤, 맞지 않는 글자가 있는 원문 어절만 표시한다.
 * 더한 말은 원문에 자리가 없어 표시하지 않는다(화면은 말한 것을 아래 줄에 따로 보인다).
 */
import { MATCH_INPUT_MAX } from './match.ts';

export type DiffWord = { text: string; differs: boolean };

const OPEN = /[(（\[【]/;
const CLOSE = /[)）\]】]/;
const COMPARABLE = /[\p{L}\p{N}]/u;

export function diffWords(target: string, said: string): DiffWord[] {
  const words = target.split(/\s+/).filter(Boolean);
  const units: { word: number; ch: string }[] = [];
  let depth = 0;
  words.forEach((w, word) => {
    for (const c of w) {
      if (OPEN.test(c)) depth += 1;
      else if (CLOSE.test(c)) depth = Math.max(0, depth - 1);
      else if (depth === 0 && COMPARABLE.test(c)) units.push({ word, ch: c.toLowerCase() });
    }
  });
  const spoken = [...said].filter((c) => COMPARABLE.test(c)).map((c) => c.toLowerCase());
  if (units.length > MATCH_INPUT_MAX || spoken.length > MATCH_INPUT_MAX) return words.map((text) => ({ text, differs: false }));

  const n = units.length;
  const m = spoken.length;
  const lcs = new Uint16Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * (m + 1) + j] =
        units[i].ch === spoken[j]
          ? lcs[(i + 1) * (m + 1) + j + 1] + 1
          : Math.max(lcs[(i + 1) * (m + 1) + j], lcs[i * (m + 1) + j + 1]);
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
