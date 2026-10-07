/**
 * 줄별 결과(reading.session). 회차의 line_results 는 줄마다 하나이고 마지막 사건이 이긴다.
 *  passed    대조 통과(misses 는 그 전 미달 횟수)
 *  unmatched 2회 미달 뒤 넘어감(read 에서는 1회 미달)
 *  skipped   quiz 의 넘어가기
 * STT 인식 불가·무발화·길이 상한 초과는 넣지 않는다. 다시 볼 대사는 unmatched·skipped 줄이다.
 * read 는 말한 것(said)만 싣고 서버가 원문과 비교해 결과를 정한다. quiz 는 진행에 대조가 쓰여 기기가 정한다.
 */
import type { LineOutcome, LineResult } from "@/lib/reading/api-types";
import type { ScriptLine } from "@/lib/reading/script/parse";
import { dialogueNumbers } from "@/lib/reading/script/parse";
import type { RunStats } from "@/lib/reading/storage";

/** 진행 저장에 싣는 줄 하나 — 기기가 정한 결과이거나, 서버가 비교할 말한 것이다. */
export type LineReport = LineResult | { line_id: string; said: string };

export interface LineResults {
  /** 미달 하나를 더한다. 돌려주는 값은 그 줄의 누적 미달 횟수. 결과는 unmatched 로 둔다(뒤에 통과하면 덮인다). */
  miss(lineId: string): number;
  pass(lineId: string): void;
  skip(lineId: string): void;
  /** read: 내 차례에 말한 것 */
  say(lineId: string, said: string): void;
  misses(lineId: string): number;
  list(): LineReport[];
  /** 기기가 정한 결과만(quiz 완료 표기) */
  outcomes(): LineResult[];
}

const isOutcome = (r: LineReport | undefined): r is LineResult => !!r && "outcome" in r;

export function createLineResults(initial: LineResult[] = []): LineResults {
  const book = new Map<string, LineReport>(initial.map((r) => [r.line_id, { ...r }]));
  const misses = (lineId: string) => {
    const r = book.get(lineId);
    return isOutcome(r) ? r.misses : 0;
  };
  const set = (lineId: string, outcome: LineOutcome, n: number) => book.set(lineId, { line_id: lineId, outcome, misses: n });
  return {
    miss(lineId) {
      const n = misses(lineId) + 1;
      set(lineId, "unmatched", n);
      return n;
    },
    pass: (lineId) => set(lineId, "passed", misses(lineId)),
    skip: (lineId) => set(lineId, "skipped", misses(lineId)),
    say: (lineId, said) => book.set(lineId, { line_id: lineId, said }),
    misses,
    list: () => [...book.values()],
    outcomes: () => [...book.values()].filter(isOutcome),
  };
}

/** quiz 완료: K = passed 줄 수, N = passed+unmatched(대조를 끝낸 서로 다른 줄), P = skipped 줄 수 */
export function quizSummary(results: LineResult[]): { passed: number; attempted: number; pending: number } {
  const passed = results.filter((r) => r.outcome === "passed").length;
  const unmatched = results.filter((r) => r.outcome === "unmatched").length;
  const pending = results.filter((r) => r.outcome === "skipped").length;
  return { passed, attempted: passed + unmatched, pending };
}

export function quizSummaryLabel(results: LineResult[]): string {
  const s = quizSummary(results);
  return `맞춘 줄 ${s.passed} / 시도 ${s.attempted} · 아직 안 나온 줄 ${s.pending}`;
}

export interface ReviewLine {
  lineId: string;
  dialogueNo: number;
  role: string;
  text: string;
  outcome: Extract<LineOutcome, "unmatched" | "skipped">;
}

/** 다시 볼 대사 — outcome 이 unmatched·skipped 인 줄, 대본 순서. 원문과 대사 번호만 보여 준다. */
export function reviewLines(script: { lines: ScriptLine[]; lineIds: string[] }, results: LineResult[]): ReviewLine[] {
  const by = new Map(results.map((r) => [r.line_id, r]));
  const nos = dialogueNumbers(script.lines);
  const out: ReviewLine[] = [];
  script.lines.forEach((l, i) => {
    const r = by.get(script.lineIds[i]);
    if (!r || l.type !== "dialogue" || r.outcome === "passed") return;
    out.push({ lineId: script.lineIds[i], dialogueNo: nos[i] ?? 0, role: l.role, text: l.text, outcome: r.outcome });
  });
  return out;
}

/**
 * 완료 화면의 다시 볼 대사. quiz 는 기기가 정한 결과로, read 는 서버가 비교해 준 different_lines 로 그린다.
 * read 에서 서버 답을 아직 받지 못했으면 null 이다.
 */
export function reviewFor(
  script: { lines: ScriptLine[]; lineIds: string[] },
  stats: Pick<RunStats, "mode" | "lineResults" | "differentLines">,
): ReviewLine[] | null {
  if (stats.mode === "quiz") return reviewLines(script, stats.lineResults);
  if (!stats.differentLines) return null;
  return stats.differentLines.flatMap((d): ReviewLine[] => {
    const line = script.lines[script.lineIds.indexOf(d.line_id)];
    return line?.type === "dialogue" ? [{ lineId: d.line_id, dialogueNo: d.dialogue_no, role: line.role, text: line.text, outcome: "unmatched" }] : [];
  });
}
