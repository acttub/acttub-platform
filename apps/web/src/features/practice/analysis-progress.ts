import type { PracticeSessionStatus } from "@/lib/api/v2/types";

// 구간 경계는 화면 비중이 아니라 실제 걸리는 시간 비중으로 나눈다.
// 압축·업로드는 보통 수 초인데 예전 경계(12·60)는 막대의 60%를 여기에 줘서
// 앞부분이 순식간에 차고 분석 구간만 하염없이 기어가는 것처럼 보였다.
export const COMPRESS_PROGRESS_END = 5;
export const UPLOAD_PROGRESS_END = 15;
export const ANALYSIS_PROGRESS_LIMIT = 95;

// 분석이 실제로 걸리는 시간.
const ANALYSIS_FILL_MS = 180_000;

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
