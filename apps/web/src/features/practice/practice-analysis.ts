/**
 * 회차의 상태(stage·작업·분석 결과)를 화면 상태로 옮기는 규칙(practice.analyze). 작업 상태(ai_jobs)와 결과
 * 상태(analyses)는 다른 것이다 — 부분 실패는 partial 로 남고 대화는 시작된다.
 */
import type { PracticeStatusResponse } from "@/lib/practice/api-types";
import type { PracticeSessionStatus } from "@/lib/api/v2/types";

export const PARTIAL_NOTICE = "일부 구간은 보지 못했어요";

export function sessionStatusOf(status: Pick<PracticeStatusResponse, "stage" | "job" | "analysis">): PracticeSessionStatus {
  if (status.analysis) return "analyzed";
  if (status.job?.status === "failed") return "failed";
  if (status.stage === "analyzing" || status.job?.status === "pending" || status.job?.status === "running") return "analyzing";
  return "failed";
}

export function analysisNotice(
  analysis: { status: "ready" | "partial" } | "ready" | "partial" | null | undefined,
): string | null {
  const status = typeof analysis === "string" ? analysis : analysis?.status;
  return status === "partial" ? PARTIAL_NOTICE : null;
}
