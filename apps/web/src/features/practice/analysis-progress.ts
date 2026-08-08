import type { PracticeSessionStatus } from "@/lib/api/v2/types";

// 구간 경계는 최우영 지정(2026-08-08): 압축 0→40 · 업로드 40→80 · 분석 80→95.
// 분석이 끝나는 순간 막대가 거의 차 있도록 뒤 구간을 좁혔다.
export const COMPRESS_PROGRESS_END = 40;
export const UPLOAD_PROGRESS_END = 80;
export const ANALYSIS_PROGRESS_LIMIT = 95;

// 분석이 실제로 걸리는 시간. 관찰 팩 교체(2026-08-06) 뒤로는 30초대에 끝난다.
// 여기가 실제보다 길면 막대가 중간에서 멈춘 채로 대화로 넘어간다.
const ANALYSIS_FILL_MS = 35_000;

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
