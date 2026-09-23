/**
 * 완료 화면(R05, reading.session)의 집계 — 다시 볼 대사, quiz 표기, 읽은 대사 수. 점수·등급·칭찬은 없다.
 */
import type { ScriptLine } from './parse.ts';
import { dialogueNumbers } from './session-plan.ts';
import type { LineOutcome, LineResult } from './types.ts';

export type ReviewLine = { lineId: string; dialogueNo: number; role: string; text: string; outcome: Extract<LineOutcome, 'unmatched' | 'skipped'> };

/** 다시 볼 대사 — outcome 이 unmatched·skipped 인 줄. 원문과 대사 번호만 있고 줄 순서다. */
export function reviewLines(input: { lines: ScriptLine[]; lineIds: string[]; lineResults: LineResult[] }): ReviewLine[] {
  const numbers = dialogueNumbers(input.lines);
  const byId = new Map(input.lineResults.map((r) => [r.line_id, r] as const));
  const out: ReviewLine[] = [];
  input.lineIds.forEach((id, i) => {
    const r = byId.get(id);
    const line = input.lines[i];
    if (!r || !line || line.type !== 'dialogue') return;
    if (r.outcome !== 'unmatched' && r.outcome !== 'skipped') return;
    out.push({ lineId: id, dialogueNo: numbers[i] ?? 0, role: line.role, text: line.text, outcome: r.outcome });
  });
  return out;
}

/** quiz 완료 — "맞춘 줄 K / 시도 N · 아직 안 나온 줄 P". K passed, N passed+unmatched, P skipped. */
export function quizSummary(lineResults: LineResult[]): { matched: number; tried: number; notYet: number } {
  let matched = 0;
  let tried = 0;
  let notYet = 0;
  for (const r of lineResults) {
    if (r.outcome === 'passed') {
      matched += 1;
      tried += 1;
    } else if (r.outcome === 'unmatched') tried += 1;
    else if (r.outcome === 'skipped') notYet += 1;
  }
  return { matched, tried, notYet };
}

/** 읽은 대사 — 구간 안 대사 줄 수(모든 배역). 부분 구간을 대본 전체 완료로 말하지 않는다. */
export function readDialogueCount(lines: ScriptLine[], startIndex: number, endIndex: number): number {
  let n = 0;
  for (let i = Math.max(0, startIndex); i <= endIndex && i < lines.length; i++) if (lines[i].type === 'dialogue') n += 1;
  return n;
}
