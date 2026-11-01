import { DEFAULT_APP_CONFIG, getAppConfig } from '../app-config.ts';

/**
 * 내 대사를 얼마나 말했는지(SOMA-804). 받아쓴 글자 수가 대본 글자 수의 90% 이상이 된 뒤의 침묵만 줄 끝으로 친다 —
 * 대사 중간의 긴 사이에 다음 줄로 넘어가 버리는 일을 막는다. 글자는 {@link diffWords} 와 같은 규칙으로 센다
 * (띄어쓰기·문장부호·괄호 안 지시·낱자모 빼고). 90%는 기본값이고, 판정은 서버 설정을 쓰는 순간 읽는다(SOMA-939).
 */
export const ADVANCE_COVERAGE = DEFAULT_APP_CONFIG.reading.advanceCoverage;

const OPEN = /[(（[【]/;
const CLOSE = /[)）\]】]/;
const COMPARABLE = /[\p{L}\p{N}]/u;
const JAMO = /[ㄱ-ㆎ]/;

const comparable = (c: string) => COMPARABLE.test(c) && !JAMO.test(c);

function lineChars(target: string): number {
  let depth = 0;
  let count = 0;
  for (const c of target) {
    if (OPEN.test(c)) depth += 1;
    else if (CLOSE.test(c)) depth = Math.max(0, depth - 1);
    else if (depth === 0 && comparable(c)) count += 1;
  }
  return count;
}

/**
 * 소리 낼 글자가 하나도 없는 줄(「...」「…」「—」, 괄호 지문뿐)인가(SOMA-962). 이런 줄은 쉬는 줄이라 마이크를 켜지 않고
 * 잠깐 보여 준 뒤 넘긴다. 「ㅋㅋㅋ」 같은 낱자모는 배우가 내는 소리라 글자로 친다.
 */
export function isWordless(text: string): boolean {
  let depth = 0;
  for (const c of text) {
    if (OPEN.test(c)) depth += 1;
    else if (CLOSE.test(c)) depth = Math.max(0, depth - 1);
    else if (depth === 0 && COMPARABLE.test(c)) return false;
  }
  return true;
}

/** 말한 글자 수 ÷ 대본 글자 수(최대 1). 셀 글자가 없는 줄은 1. */
export function spokenCoverage(target: string, said: string): number {
  const total = lineChars(target);
  if (total === 0) return 1;
  const spoken = [...said].filter(comparable).length;
  return Math.min(1, spoken / total);
}

/** 침묵으로 넘겨도 될 만큼 말했는가. */
export function saidEnough(target: string, said: string): boolean {
  return spokenCoverage(target, said) >= getAppConfig().reading.advanceCoverage;
}
