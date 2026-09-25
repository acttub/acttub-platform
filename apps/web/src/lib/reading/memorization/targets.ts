/**
 * 암기 화면의 대상(reading.memorization). 대본에서 들어오면 고른 배역의 대사 가운데 memorized 가 아닌 줄(행 없음
 * 포함)이고, 완료 화면의 다시 볼 대사에서 들어오면 그 줄들(memorized 여도 열고 표시는 그대로)이다. 화면은 바로
 * 전 상대 대사를 함께 보여 준다.
 */
import type { MemorizationEntry } from "@/lib/reading/api-types";
import { dialogueNumbers, type ScriptLine } from "@/lib/reading/script/parse";

export const EMPTY_TARGETS_COPY = "못 외운 대사가 없어요";

export interface TargetLine {
  lineId: string;
  index: number;
  dialogueNo: number;
  role: string;
  text: string;
  memorized: boolean;
  previousPartner: { role: string; text: string } | null;
}

export interface MemorizationTargets {
  lines: TargetLine[];
  /** 내 대사 가운데 memorized 인 줄 수 */
  memorizedCount: number;
  /** 내 대사 수 */
  total: number;
}

export function memorizationTargets(
  script: { lines: ScriptLine[]; lineIds: string[] },
  myRoles: string[],
  entries: MemorizationEntry[],
  options: { includeMemorized?: boolean; onlyLineIds?: string[] } = {},
): MemorizationTargets {
  const mine = new Set(myRoles);
  const status = new Map(entries.map((e) => [e.line_id, e.status]));
  const only = options.onlyLineIds ? new Set(options.onlyLineIds) : null;
  const nos = dialogueNumbers(script.lines);
  const lines: TargetLine[] = [];
  let memorizedCount = 0;
  let total = 0;
  let lastPartner: { role: string; text: string } | null = null;
  script.lines.forEach((l, i) => {
    if (l.type !== "dialogue") return;
    const lineId = script.lineIds[i];
    if (!mine.has(l.role)) {
      lastPartner = { role: l.role, text: l.text };
      return;
    }
    total++;
    const memorized = status.get(lineId) === "memorized";
    if (memorized) memorizedCount++;
    const wanted = only ? only.has(lineId) : options.includeMemorized || !memorized;
    if (wanted) lines.push({ lineId, index: i, dialogueNo: nos[i] ?? 0, role: l.role, text: l.text, memorized, previousPartner: lastPartner });
  });
  return { lines, memorizedCount, total };
}

export function memorizationHeading(myRoles: string[], count: number): string {
  return `${myRoles.join(", ")} 역 · 암기하지 못한 대사 ${count}개`;
}

export function memorizationProgress(t: Pick<MemorizationTargets, "memorizedCount" | "total">): string {
  return `외운 줄 ${t.memorizedCount} / 내 대사 ${t.total}`;
}
