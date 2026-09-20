/**
 * 구간(reading.session). 웹 1.0.0 은 전체 구간으로 시작한다 — 시작은 첫 대사 줄, 끝은 마지막 대사 줄이다.
 * 진행 "K / N" 의 N 은 구간 안 대사 줄 수(모든 배역, 지문·장면 제외)다.
 */
import type { ScriptLine } from "@/lib/reading/script/parse";

export interface RangeSource {
  lines: ScriptLine[];
  /** lines 와 같은 순서의 줄 id */
  lineIds: string[];
}

export interface LineRange {
  startLineId: string;
  endLineId: string;
}

export function indexOfLine(script: RangeSource, lineId: string | null | undefined): number {
  return lineId ? script.lineIds.indexOf(lineId) : -1;
}

/** 첫 대사 줄부터 마지막 대사 줄까지. 대사가 없으면 null. */
export function fullRange(script: RangeSource): LineRange | null {
  let first = -1;
  let last = -1;
  script.lines.forEach((l, i) => {
    if (l.type !== "dialogue") return;
    if (first < 0) first = i;
    last = i;
  });
  if (first < 0) return null;
  return { startLineId: script.lineIds[first], endLineId: script.lineIds[last] };
}

/** 구간의 [시작, 끝] 인덱스. 줄 id 를 못 찾으면 대본 전체다. */
export function rangeIndexes(script: RangeSource, range: LineRange | null): { start: number; end: number } {
  const start = range ? indexOfLine(script, range.startLineId) : -1;
  const end = range ? indexOfLine(script, range.endLineId) : -1;
  return { start: start < 0 ? 0 : start, end: end < 0 ? script.lines.length - 1 : end };
}

/** 구간 안 내 대사 수. 0 이면 서버가 422 empty_range 로 거절한다. */
export function myDialogueCount(script: RangeSource, myRoles: string[], range: LineRange | null): number {
  const mine = new Set(myRoles);
  const { start, end } = rangeIndexes(script, range);
  let n = 0;
  for (let i = start; i <= end; i++) {
    const l = script.lines[i];
    if (l?.type === "dialogue" && mine.has(l.role)) n++;
  }
  return n;
}

/** 구간의 시작·끝 대사 번호(카드 표시용). */
export function rangeDialogueNos(script: RangeSource, startLineId: string, endLineId: string): { start: number; end: number } {
  let n = 0;
  let start = 0;
  let end = 0;
  script.lines.forEach((l, i) => {
    if (l.type !== "dialogue") return;
    n++;
    if (script.lineIds[i] === startLineId) start = n;
    if (script.lineIds[i] === endLineId) end = n;
  });
  return { start, end };
}

/**
 * 이어하기: 현재 줄 직전의 상대 대사 하나(의 인덱스). 흐름을 잡아 주려고 먼저 읽는다.
 * 없으면 -1. 구간 시작 앞으로는 가지 않는다.
 */
export function partnerLineBefore(script: RangeSource, index: number, myRoles: string[], rangeStart: number): number {
  const mine = new Set(myRoles);
  for (let i = index - 1; i >= rangeStart; i--) {
    const l = script.lines[i];
    if (l?.type === "dialogue" && !mine.has(l.role)) return i;
  }
  return -1;
}
