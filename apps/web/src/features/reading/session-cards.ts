/**
 * 대본 상세의 회차 카드가 보여 주는 말(reading.session). 순수 함수라 화면 없이 테스트한다.
 */
import type { SessionCard, SessionDetail } from "@/lib/reading/api-types";
import { dialogueNumbers } from "@/lib/reading/script/parse";
import { indexOfLine } from "@/lib/reading/session/range";
import type { StoredScript } from "@/lib/reading/storage";
import { myCharactersLabel, sessionStatusLabel } from "@/features/reading/session-copy";

export function sessionCardLine(card: SessionCard): string {
  const parts = [
    `${card.ordinal}회차`,
    sessionStatusLabel(card.status),
    myCharactersLabel(card.my_character_names),
    `내 대사 ${card.my_dialogue_count}개 중 ${card.recorded_line_count}개 녹음`,
    elapsedLabel(card.elapsed_seconds),
  ];
  return parts.join(" · ");
}

export function elapsedLabel(seconds: number): string {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function sessionDateLabel(iso: string, timeZone?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, month: "numeric", day: "numeric" }).formatToParts(d);
  const pick = (t: string) => parts.find((p) => p.type === t)?.value;
  return `${pick("month")}월 ${pick("day")}일`;
}

/**
 * 열린 회차의 "이어서 연습 · K / N". N 은 구간 안 대사 줄 수, K 는 지난 대사 수 — current_line 이 다음에
 * 할 줄이므로 그 앞까지가 지난 것이다.
 */
export function resumeProgress(script: Pick<StoredScript, "lines" | "lineIds">, session: Pick<SessionDetail, "start_line_id" | "end_line_id" | "current_line_id">): { done: number; total: number } {
  const nos = dialogueNumbers(script.lines);
  const start = indexOfLine(script, session.start_line_id);
  const end = indexOfLine(script, session.end_line_id);
  const current = indexOfLine(script, session.current_line_id);
  const startNo = start >= 0 ? (nos[start] ?? 0) : 1;
  const endNo = end >= 0 ? (nos[end] ?? 0) : nos.filter((n) => n !== null).length;
  const total = Math.max(0, endNo - startNo + 1);
  if (current < 0) return { done: 0, total };
  // 현재 줄이 대사가 아니면(상대 줄에서 저장) 그 앞 대사까지 센다.
  let currentNo = nos[current];
  for (let i = current; currentNo === null && i >= 0; i--) currentNo = nos[i];
  return { done: Math.max(0, (currentNo ?? startNo) - startNo), total };
}
