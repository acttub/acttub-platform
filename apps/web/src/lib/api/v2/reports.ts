import { apiFetch, type ApiResponse } from "./client";
import {
  postIdempotent,
  type PostIdempotentOptions,
} from "./idempotency";
import type {
  CreateReportResponse,
  ReportHistoryResponse,
  ReportReq,
} from "./types";

export function createReport(
  body: ReportReq,
  options?: PostIdempotentOptions,
): Promise<ApiResponse<CreateReportResponse>> {
  return postIdempotent<CreateReportResponse>("/v2/reports", body, options);
}

export async function listReports(): Promise<ReportHistoryResponse> {
  const { data } = await apiFetch<ReportHistoryResponse>("/v2/reports");
  return data;
}
