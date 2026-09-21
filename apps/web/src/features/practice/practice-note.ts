/**
 * 연습 노트(practice.note)의 표시 규칙. 순수 함수라 화면 없이 테스트한다.
 *
 * 노트는 그 회차만 말한다 — 이전 연습과 견주지 않고, 확인·동의를 강제하지 않는다. 제목은 초점 문구
 * 원문이고(고정 제목 "연습 노트"는 없앴다), 초점 없이 끝난 record_only 는 제목이 없어 묶음의 대체
 * 제목을 쓴다. 화면 순서는 짧은 요약 → 다음 촬영에서 해볼 한 가지 → 응원이다(PRD).
 */
import type { NoteKind, NoteQuote, PracticeNote, QuoteSource } from "@/lib/practice/api-types";
import { UNTITLED_PRACTICE } from "./practice-groups";

/** 요약에 싣는 원문 발췌의 최대 개수. 더 오면 앞의 둘만 보인다. */
export const MAX_SUMMARY_QUOTES = 2;

/** 제안이 없는 노트가 그 자리에 두는 말. 없는 것을 지어내지 않는다. */
export const NO_NEXT_TAKE_COPY = "이번에는 다음 촬영 과제를 정하지 않았어요";
/** 초점 없이 끝난 회차 */
export const RECORD_ONLY_COPY = "오늘 나눈 것만 남겼어요";
/** 생성이 거듭 실패해 확인된 것만 담은 노트 */
export const FALLBACK_NOTICE = "대화에서 확인한 것만 남겼어요";

/** 신형(v2) 노트인가. 옛 노트는 summary_quotes·kind 가 없다. */
export function isNoteV2(report: unknown): report is PracticeNote {
  if (report === null || typeof report !== "object") return false;
  const candidate = report as Partial<PracticeNote>;
  return Array.isArray(candidate.summary_quotes) && typeof candidate.kind === "string";
}

/**
 * 화면에 거는 제목. 초점이 있으면 그 원문이고, 없으면 묶음이 쓰는 대체 제목(상황 문장, 그것도
 * 없으면 "제목 없는 연습")이다 — 목록과 상세가 같은 이름으로 불려야 한다.
 */
export function noteTitle(note: PracticeNote, groupTitle: string): string {
  return note.title?.trim() || groupTitle.trim() || UNTITLED_PRACTICE;
}

/** 요약 인용. 최대 둘이고 빈 인용은 뺀다. */
export function noteQuotes(note: PracticeNote): NoteQuote[] {
  return note.summary_quotes.filter((quote) => quote.text.trim()).slice(0, MAX_SUMMARY_QUOTES);
}

/** 인용이 어디서 나온 말인지. 배우가 자기 말을 알아볼 수 있어야 한다. */
export function quoteSourceLabel(source: QuoteSource): string {
  return source === "actor" ? "내가 한 말" : "영상에서 본 것";
}

/** 다음 촬영 자리에 그릴 말. 제안이 없으면 종류에 맞는 빈 자리를 말한다. */
export function nextTakeCopy(note: PracticeNote): string {
  const take = note.next_take?.trim();
  if (take) return take;
  return note.kind === "record_only" ? RECORD_ONLY_COPY : NO_NEXT_TAKE_COPY;
}

/** 종류 자체는 화면에 성공·실패로 비치지 않게 문구로만 드러난다. */
export function isProposal(kind: NoteKind): boolean {
  return kind === "action";
}

/**
 * 계측·화면 분기가 쓰는 노트 종류. 신형 노트는 종류가 kind 로 갈리지만 이 자리에서는 옛 값과
 * 같은 이름으로 센다 — 계측 계약(practice_result_viewed·practice_dialogue_completed)을 바꾸지 않는다.
 */
export function reportTypeOf(
  report: { report_type?: string } | PracticeNote | null | undefined,
): "analysis" | "expression" | "blocked" | "practice_note" {
  if (!report) return "blocked";
  if (isNoteV2(report)) return "practice_note";
  const type = (report as { report_type?: string }).report_type;
  return type === "analysis" || type === "expression" || type === "practice_note" ? type : "blocked";
}

/** 되돌아갈 대화가 없는 노트인가(막힌 대화). 신형 노트에는 이 자리가 없다. */
export function isBlockedReport(report: { report_type?: string } | PracticeNote): boolean {
  return !isNoteV2(report) && (report as { report_type?: string }).report_type === "blocked";
}
