import type { PracticeSessionStatus } from "@/lib/api/v2/types";

export const COMPRESS_PROGRESS_END = 12;
export const UPLOAD_PROGRESS_END = 60;
export const ANALYSIS_PROGRESS_LIMIT = 95;

const ANALYSIS_FILL_MS = 60_000;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function compressionProgress(ratio: number): number {
  return clamp(ratio, 0, 1) * COMPRESS_PROGRESS_END;
}

export function uploadProgress(percent: number): number {
  const ratio = clamp(percent, 0, 100) / 100;
  return (
    COMPRESS_PROGRESS_END
    + ratio * (UPLOAD_PROGRESS_END - COMPRESS_PROGRESS_END)
  );
}

export function analysisProgress(elapsedMs: number): number {
  const ratio = clamp(elapsedMs, 0, ANALYSIS_FILL_MS) / ANALYSIS_FILL_MS;
  return (
    UPLOAD_PROGRESS_END
    + ratio * (ANALYSIS_PROGRESS_LIMIT - UPLOAD_PROGRESS_END)
  );
}

export function advanceProgress(current: number, candidate: number): number {
  return Math.max(clamp(current, 0, 100), clamp(candidate, 0, 100));
}

export function settleProgress(
  current: number,
  status: PracticeSessionStatus,
): number {
  return status === "analyzed" ? 100 : current;
}
