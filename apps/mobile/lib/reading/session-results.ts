/**
 * 완료 화면(R9.23)·다르게 말한 대사 전체(R9.26, reading.session)의 집계. 점수·등급·칭찬은 없다.
 * 「원문과 다르게 말한 대사」는 읽어주기 대조에서 미달(unmatched)한 내 줄이고, 화면은 원문의 다른 어절을
 * 노랗게 칠하고 아래에 말한 것을 보인다(components/diff-text).
 */
import type { ScriptLine } from './parse.ts';
import { dialogueNumbers } from './session-plan.ts';
import type { RunLineResult } from './session-run.ts';

export type SpokenLine = { lineId: string; dialogueNo: number; role: string; text: string; said: string | null };

type RangeInput = {
  lines: ScriptLine[];
  lineIds: string[];
  startIndex: number;
  endIndex: number;
  results: Record<string, Pick<RunLineResult, 'outcome' | 'said'>>;
};

/** 구간 안에서 원문과 다르게 말한 내 대사 — 줄 순서, 원문·대사 번호·말한 것. */
export function differentLines(input: RangeInput): SpokenLine[] {
  const numbers = dialogueNumbers(input.lines);
  const out: SpokenLine[] = [];
  for (let i = Math.max(0, input.startIndex); i <= input.endIndex && i < input.lines.length; i++) {
    const line = input.lines[i];
    const r = input.results[input.lineIds[i]];
    if (!r || line.type !== 'dialogue' || r.outcome !== 'unmatched') continue;
    out.push({ lineId: input.lineIds[i], dialogueNo: numbers[i] ?? 0, role: line.role, text: line.text, said: r.said });
  }
  return out;
}

/** R9.26 「대본 흐름」의 한 줄 — 구간 대본 전체를 위에서 아래로, 다르게 말한 내 줄만 different 가 있다. */
export type FlowRow = { lineId: string; line: ScriptLine; mine: boolean; different: SpokenLine | null };

export function flowRows(input: RangeInput & { myRoles: string[] }): FlowRow[] {
  const different = new Map(differentLines(input).map((d) => [d.lineId, d] as const));
  const rows: FlowRow[] = [];
  for (let i = Math.max(0, input.startIndex); i <= input.endIndex && i < input.lines.length; i++) {
    const line = input.lines[i];
    const lineId = input.lineIds[i];
    const mine = line.type === 'dialogue' && input.myRoles.includes(line.role);
    rows.push({ lineId, line, mine, different: different.get(lineId) ?? null });
  }
  return rows;
}

/** 읽은 대사 — 구간 안 대사 줄 수(모든 배역). 부분 구간을 대본 전체 완료로 말하지 않는다. */
export function readDialogueCount(lines: ScriptLine[], startIndex: number, endIndex: number): number {
  let n = 0;
  for (let i = Math.max(0, startIndex); i <= endIndex && i < lines.length; i++) if (lines[i].type === 'dialogue') n += 1;
  return n;
}
