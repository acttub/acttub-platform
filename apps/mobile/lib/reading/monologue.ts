/**
 * 독백 리딩(SOMA-597, reading.session 「독백」) — 순수 함수. 화면·오디오·서버를 모른다.
 *
 * 배역이 하나뿐인 대본은 서버가 문장마다 한 줄로 나눠 둔다. 독백은 처음부터 끝까지 끊지 않고 한 번에 녹음하고, 읽는 동안에는 판정하지
 * 않는다. 받아쓴 글 전체를 문장들과 글자 단위로 맞춰(최장 공통 부분열, 띄어쓰기·문장부호·괄호 안 지시·낱자모는 빼고 — word-diff 와 같은
 * 글자 규칙) 강조할 문장을 옮기고, 끝난 뒤 문장마다 말한 부분을 떼어 맞게 읽음·빠뜨림·다르게 읽음을 정한다. 맞게 읽음의 통과선은
 * 서버 LineMatch 와 같은 자모 편집 거리 0.72 다 — 떼어 낸 말을 진행 저장에 실으면 서버도 같은 판정을 낸다.
 */
import { getAppConfig } from '../app-config.ts';
import type { RunState } from './session-run.ts';

export type SentenceStatus = 'read' | 'missed' | 'different';
export type AlignedSentence = { status: SentenceStatus; said: string };

/*
 * 판정선은 서버 설정(getAppConfig().reading, SOMA-939)을 함수 안에서 읽는다. 기본값:
 * - monologuePass 0.72 — 서버 LineMatch.PASS_THRESHOLD 와 같다.
 * - monologueMissedBelow 0.3 — 문장 글자 가운데 받아쓴 글과 맞은 비율이 이보다 낮으면 그 문장은 말하지 않은 것(빠뜨림)이다.
 * - monologueNextAt 0.8 — 강조를 다음 문장으로 넘기는, 지금 문장 글자가 맞은 비율.
 * - monologueTouchMin 3 — 문장을 읽기 시작했다고 보는 맞은 글자 수. 멀리 떨어진 문장의 한두 글자 우연 일치로 강조가 뛰지 않게.
 */
/** 맞춰 볼 표의 칸 수 상한(원문 글자 × 받아쓴 글자). 넘으면 강조를 옮기지 않는다 — 녹음 3분이면 대개 1,000자 안쪽이다. */
const CELLS_MAX = 4_000_000;

const OPEN = /[(（[【]/;
const CLOSE = /[)）\]】]/;
const COMPARABLE = /[\p{L}\p{N}]/u;
const JAMO = /[ㄱ-ㆎ]/;
const comparable = (c: string) => COMPARABLE.test(c) && !JAMO.test(c);

/** 배역이 하나뿐인 대본인가 — 함께 말하는 줄의 묶음 배역은 세지 않는다. */
export function isMonologue(characters: { member_ids?: string[] }[]): boolean {
  return characters.filter((c) => !(c.member_ids?.length)).length === 1;
}

type Unit = { sentence: number; ch: string };

function sentenceUnits(sentences: string[]): Unit[] {
  const units: Unit[] = [];
  sentences.forEach((text, sentence) => {
    let depth = 0;
    for (const c of text) {
      if (OPEN.test(c)) depth += 1;
      else if (CLOSE.test(c)) depth = Math.max(0, depth - 1);
      else if (depth === 0 && comparable(c)) units.push({ sentence, ch: c.toLowerCase() });
    }
  });
  return units;
}

/** 받아쓴 글의 비교할 글자와 그 글자의 자리(UTF-16, 떼어 낼 때 쓴다). */
function spokenUnits(said: string): { ch: string; at: number }[] {
  const out: { ch: string; at: number }[] = [];
  let at = 0;
  for (const c of said) {
    if (comparable(c)) out.push({ ch: c.toLowerCase(), at });
    at += c.length;
  }
  return out;
}

/** 문장마다 맞은 글자 수와 맞은 받아쓴 글자의 첫·끝 자리. 표가 너무 크면 null. */
function match(sentences: string[], said: string) {
  const units = sentenceUnits(sentences);
  const spoken = spokenUnits(said);
  const n = units.length;
  const m = spoken.length;
  if ((n + 1) * (m + 1) > CELLS_MAX) return null;
  const width = m + 1;
  const lcs = new Uint16Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * width + j] = units[i].ch === spoken[j].ch ? lcs[(i + 1) * width + j + 1] + 1 : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
    }
  }
  const total = sentences.map(() => 0);
  units.forEach((u) => (total[u.sentence] += 1));
  const hit = sentences.map(() => 0);
  const first = sentences.map(() => -1);
  const last = sentences.map(() => -1);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (units[i].ch === spoken[j].ch && lcs[i * width + j] === lcs[(i + 1) * width + j + 1] + 1) {
      const k = units[i].sentence;
      hit[k] += 1;
      if (first[k] < 0) first[k] = j;
      last[k] = j;
      i += 1;
      j += 1;
    } else if (lcs[(i + 1) * width + j] >= lcs[i * width + j + 1]) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return { total, hit, first, last, spoken };
}

/** 끝난 뒤 문장별 판정. 빠뜨린 문장의 말한 것은 빈 글이다. */
export function alignSentences(sentences: string[], said: string): AlignedSentence[] {
  const found = match(sentences, said);
  const { monologuePass, monologueMissedBelow } = getAppConfig().reading;
  return sentences.map((text, k) => {
    if (!found) return { status: 'missed', said: '' };
    if (found.total[k] === 0) return { status: 'read', said: '' };
    if (found.hit[k] / found.total[k] < monologueMissedBelow) return { status: 'missed', said: '' };
    const from = found.spoken[found.first[k]].at;
    const lastUnit = found.spoken[found.last[k]];
    const piece = said.slice(from, lastUnit.at + lastUnit.ch.length).trim();
    return { status: similarity(piece, text) >= monologuePass ? 'read' : 'different', said: piece };
  });
}

/**
 * 지금 읽는 문장(0부터). 읽기 시작한 마지막 문장이고, 그 문장을 거의 다 읽었으면 다음 문장이다. 마지막 문장에 머물고, 앞 위치보다
 * 뒤로 가지 않는다(받아쓰기가 고쳐 쓰며 잠깐 줄어도 강조가 되돌아가지 않게).
 */
export function livePosition(sentences: string[], said: string, previous: number): number {
  const found = match(sentences, said);
  if (!found) return previous;
  const { monologueTouchMin, monologueNextAt } = getAppConfig().reading;
  let at = -1;
  sentences.forEach((_, k) => {
    if (found.hit[k] >= Math.min(monologueTouchMin, found.total[k]) && found.hit[k] > 0) at = k;
  });
  if (at < 0) return previous;
  const next = found.hit[at] / found.total[at] >= monologueNextAt ? Math.min(at + 1, sentences.length - 1) : at;
  return Math.max(previous, next);
}

/** 결과 화면과 진행 저장. said 는 진행 저장의 줄 결과로 싣는 문장별 말한 것 — 빠뜨린 문장은 싣지 않는다(서버도 무발화는 넣지 않는다). */
export function monologueResults(lineIds: string[], sentences: string[], said: string) {
  const aligned = alignSentences(sentences, said);
  const rows = aligned.map((a, k) => ({ lineId: lineIds[k], text: sentences[k], ...a }));
  const saidByLine: Record<string, string> = {};
  rows.forEach((r) => {
    if (r.status !== 'missed' && r.said) saidByLine[r.lineId] = r.said;
  });
  return { rows, missed: rows.filter((r) => r.status === 'missed').length, said: saidByLine };
}

// ── 서버 LineMatch 와 같은 가까움 ───────────────────────────────────────────────
const BRACKETED = /[(（[【][^)）\]】]*[)）\]】]/g;
const NOT_SPOKEN = /[^\p{L}\p{N}]+|[ㄱ-ㆎ]+/gu;
const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const JUNG = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ';
const JONG = ['', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];

function jamo(text: string): string {
  const plain = text.replace(BRACKETED, '').replace(NOT_SPOKEN, '').toLowerCase();
  let out = '';
  for (const c of plain) {
    const code = c.codePointAt(0)!;
    if (code < 0xac00 || code > 0xd7a3) {
      out += c;
      continue;
    }
    const index = code - 0xac00;
    out += CHO[Math.floor(index / 588)] + JUNG[Math.floor((index % 588) / 28)] + JONG[index % 28];
  }
  return out;
}

/** 1 − 자모 편집 거리 / 긴 쪽 길이(UTF-16 단위). */
export function similarity(said: string, target: string): number {
  const a = jamo(said);
  const b = jamo(target);
  if (!a.length && !b.length) return 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return 1 - prev[b.length] / Math.max(a.length, b.length);
}

/** 끝내기 — 문장별 말한 것을 싣고 실행을 끝낸다. 진행 저장(progressPayload)이 그 말한 것을 줄 결과로 보낸다. */
export function finishMonologueRun(run: RunState, said: Record<string, string>): RunState {
  if (run.status === 'done') return run;
  return { ...run, said: { ...run.said, ...said }, index: run.endIndex + 1, status: 'done', resumeTo: null, leadInUntil: null };
}

/** 독백 말풍선 하나에 담는 대사 수(SOMA-934). */
export const MONOLOGUE_CHUNK = 10;

/**
 * 독백 구간을 대사 size 줄씩 말풍선으로 끊는다(SOMA-934) — 줄 인덱스 [start, end] 묶음. 지문은 다음 대사가 든 말풍선에 붙고,
 * 구간 끝의 지문은 마지막 말풍선에 남는다. 녹음·판정은 묶음과 상관없이 구간 전체로 한다.
 */
export function monologueChunks(
  lines: readonly { type: string }[],
  startIndex: number,
  endIndex: number,
  size: number = MONOLOGUE_CHUNK,
): { start: number; end: number }[] {
  const chunks: { start: number; end: number }[] = [];
  let chunkStart = startIndex;
  let count = 0;
  let lastDialogue = -1;
  for (let i = startIndex; i <= endIndex && i < lines.length; i++) {
    if (lines[i].type !== 'dialogue') continue;
    if (count === size) {
      chunks.push({ start: chunkStart, end: lastDialogue });
      chunkStart = lastDialogue + 1;
      count = 0;
    }
    count += 1;
    lastDialogue = i;
  }
  chunks.push({ start: chunkStart, end: Math.min(endIndex, lines.length - 1) });
  return chunks;
}

/** 실행에서 맞춰 볼 문장(대사 줄)의 줄 인덱스 — from(처음 듣기 시작한 줄)부터 구간 끝까지. */
export function sentenceIndexes(run: Pick<RunState, 'lines' | 'endIndex'>, from: number): number[] {
  const out: number[] = [];
  for (let i = from; i <= run.endIndex && i < run.lines.length; i++) if (run.lines[i]?.type === 'dialogue') out.push(i);
  return out;
}
