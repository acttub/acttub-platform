/**
 * 대본 넣기 화면(D13)의 최근 대본 목록이 카드에 보여 주는 말(reading.script). 순수 함수라
 * 화면 없이 테스트한다. 문구의 규칙은 여기 한 곳에만 둔다.
 */
import type { ScriptCard, ScriptListResponse } from "@/lib/reading/api-types";

/** 등록 화면의 저작권 안내 한 줄. 사용자가 올린 대본의 권리 책임은 이용약관에 있다(법무 확인). */
export const COPYRIGHT_NOTICE = "연습 목적으로만 보관하고 다른 사람에게 보여 주지 않아요.";

export function listHeadline(list: Pick<ScriptListResponse, "total_count" | "in_progress_count">): string {
  return `전체 ${list.total_count}개 · 연습 중 ${list.in_progress_count}개`;
}

export type ChipTone = "blue" | "neutral";

/** 상태 칩은 셋이다. pen R00 의 "분석 완료"는 리딩에 분석이 없으므로 없다. */
export function statusChip(card: Pick<ScriptCard, "status">): { label: string; tone: ChipTone } {
  switch (card.status) {
    case "reading":
      return { label: "연습 중", tone: "blue" };
    case "completed":
      return { label: "연습 완료", tone: "neutral" };
    default:
      return { label: "배역 선택", tone: "neutral" };
  }
}

/** 마지막 회차의 내 배역. 회차가 없으면 아직 고르지 않은 것이다. */
export function myCharactersLabel(card: Pick<ScriptCard, "my_character_names">): string {
  return card.my_character_names.length === 0 ? "배역 미선택" : card.my_character_names.join(", ");
}

function calendarParts(date: Date, timeZone?: string): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric", day: "numeric" }).formatToParts(date);
  const pick = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: pick("year"), month: pick("month"), day: pick("day") };
}

function dayNumber(p: { year: number; month: number; day: number }): number {
  return Date.UTC(p.year, p.month - 1, p.day) / 86_400_000;
}

/**
 * "어제 연습"·"5월 25일 업로드". 회차가 있었던 대본(내 배역이 있음)의 마지막 활동은 연습이고,
 * 회차가 없으면 업로드다. 날짜는 보는 사람의 달력(브라우저 시간대)으로 센다.
 */
export function activityLabel(
  card: Pick<ScriptCard, "last_activity_at" | "my_character_names">,
  now: Date = new Date(),
  timeZone?: string,
): string {
  const kind = card.my_character_names.length > 0 ? "연습" : "업로드";
  const at = new Date(card.last_activity_at);
  if (Number.isNaN(at.getTime())) return kind;
  const then = calendarParts(at, timeZone);
  const today = calendarParts(now, timeZone);
  const diff = dayNumber(today) - dayNumber(then);
  if (diff === 0) return `오늘 ${kind}`;
  if (diff === 1) return `어제 ${kind}`;
  const day = `${then.month}월 ${then.day}일`;
  return `${then.year === today.year ? day : `${then.year}년 ${day}`} ${kind}`;
}
