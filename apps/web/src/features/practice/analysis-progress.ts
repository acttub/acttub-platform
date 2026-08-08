import type { PracticeSessionStatus } from "@/lib/api/v2/types";

// 구간 경계는 최우영 지정(2026-08-08). 기다리는 시간의 대부분이 분석이므로 앞머리를 좁게 준다.
//   압축 없음(대부분): 업로드 0→20 · 분석 20→95
//   압축 있음(50MB 초과 + WebCodecs): 압축 0→10 · 업로드 10→20 · 분석 20→95
// 웹은 compress-video.ts가 50MB 이하를 그냥 통과시키므로 압축 없는 쪽이 기본 경로다.
export const COMPRESS_PROGRESS_END = 10;
export const UPLOAD_PROGRESS_END = 20;
export const ANALYSIS_PROGRESS_LIMIT = 95;

// 분석이 실제로 걸리는 시간. 관찰 팩 교체(2026-08-06) 뒤로는 30초대에 끝난다.
// 여기가 실제보다 길면 막대가 중간에서 멈춘 채로 대화로 넘어간다.
const ANALYSIS_FILL_MS = 30_000;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function compressionProgress(ratio: number): number {
  return clamp(ratio, 0, 1) * COMPRESS_PROGRESS_END;
}

// 압축을 건너뛴 영상은 업로드가 0에서 시작해야 한다 — 압축 구간을 비워 두면
// 막대가 0에 멈춰 있다가 첫 업로드 틱에 껑충 뛴다.
export function uploadProgress(percent: number, compressed: boolean): number {
  const start = compressed ? COMPRESS_PROGRESS_END : 0;
  const ratio = clamp(percent, 0, 100) / 100;
  return start + ratio * (UPLOAD_PROGRESS_END - start);
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
