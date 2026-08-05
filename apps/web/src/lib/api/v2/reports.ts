import { apiFetch, type ApiResponse } from "./client";
import {
  postIdempotent,
  type PostIdempotentOptions,
} from "./idempotency";
import type {
  PracticeReport,
  ReportDetailResponse,
  ReportHistoryResponse,
  ReportReq,
} from "./types";

export function createReport(
  body: ReportReq,
  options?: PostIdempotentOptions,
): Promise<ApiResponse<PracticeReport>> {
  return postIdempotent<PracticeReport>("/v2/reports", body, options);
}

export async function listReports(): Promise<ReportHistoryResponse> {
  const { data } = await apiFetch<ReportHistoryResponse>("/v2/reports");
  return data;
}

export async function getReport(
  practiceSessionId: string,
): Promise<ReportDetailResponse> {
  const { data } = await apiFetch<ReportDetailResponse>(
    `/v2/reports/${encodeURIComponent(practiceSessionId)}`,
  );
  return data;
}
