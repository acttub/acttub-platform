import type { PracticeSessionStatus } from "@/lib/api/v2/types";

// 구간 경계는 최우영 지정(2026-08-08). 기다리는 시간의 대부분이 분석이므로 앞머리를 좁게 준다.
//   압축 없음(대부분): 업로드 0→20 · 분석 20→95
//   압축 있음(50MB 초과 + WebCodecs): 압축 0→10 · 업로드 10→20 · 분석 20→95
// 웹은 compress-video.ts가 50MB 이하를 그냥 통과시키므로 압축 없는 쪽이 기본 경로다.
export const COMPRESS_PROGRESS_END = 10;
export const UPLOAD_PROGRESS_END = 20;
export const ANALYSIS_PROGRESS_LIMIT = 95;

// 분석 구간은 남은 시간을 모른다 — 분석에 걸리는 시간은 영상 길이에 따라 달라지고,
// 고정 시간으로 채우면 짧은 영상은 중간에서 대화로 넘어가고 긴 영상은 95에서 멈춘다
// (2026-08-08에 180초·35초·30초로 세 번 틀렸다). 그래서 시간을 맞추지 않고
// 영상 길이를 시상수로 쓰는 점근 곡선으로 채운다 — 느려질 뿐 멈추지 않는다.
//   pct = 20 + 80 × (1 − e^(−경과/영상길이))
// 다만 100은 "끝났다"여야 하므로(settleProgress) 95에서 상한을 건다.
// 목록에서 연 세션은 영상 길이를 모르므로 그때만 이 값을 시상수로 쓴다.
const ANALYSIS_TAU_FALLBACK_MS = 30_000;

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

export function analysisProgress(
  elapsedMs: number,
  videoDurationMs: number | null,
): number {
  const tau =
    videoDurationMs !== null && videoDurationMs > 0
      ? videoDurationMs
      : ANALYSIS_TAU_FALLBACK_MS;
  const filled = 80 * (1 - Math.exp(-Math.max(elapsedMs, 0) / tau));
  return Math.min(ANALYSIS_PROGRESS_LIMIT, UPLOAD_PROGRESS_END + filled);
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
