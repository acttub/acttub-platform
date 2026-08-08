import type { PracticeSessionStatus } from "@/lib/api/v2/types";

// 구간 경계는 최우영 지정(2026-08-08). 기다리는 시간의 대부분이 분석이므로 앞머리를 좁게 준다.
//   압축 없음(대부분): 업로드 0→20 · 분석 20→95
//   압축 있음(50MB 초과 + WebCodecs): 압축 0→10 · 업로드 10→20 · 분석 20→95
// 웹은 compress-video.ts가 50MB 이하를 그냥 통과시키므로 압축 없는 쪽이 기본 경로다.
export const COMPRESS_PROGRESS_END = 10;
export const UPLOAD_PROGRESS_END = 20;
export const ANALYSIS_PROGRESS_LIMIT = 95;

// 분석 구간은 영상 길이에 비례해 채운다.
//   pct = min(95, 20 + 80 × 경과/영상길이)
//
// 고정 시간(180초·35초·30초로 2026-08-08에 세 번 틀렸다)이 아니라 영상 길이를 쓰는 근거는
// 실측이다 — dev 에서 47초 영상의 분석이 41.4초 걸렸다(영상 길이의 0.88배, 2026-08-08).
// 막대는 영상 길이의 0.94배 지점에서 95에 닿으므로, 그 비율이면 분석이 끝나는 순간
// 90% 언저리이고 멈추는 구간이 없다.
//
// ⚠️ 분석이 영상 길이보다 오래 걸리면(0.94배 초과) 95에서 멈춘 채로 기다린다.
// 그런 영상이 보이면 여기를 점근 곡선으로 바꾼다 — 20 + 80 × (1 − e^(−경과/(영상길이/2)))
// 이면 멈추지 않고, 위 실측 비율에서 86% 언저리에 닿는다.
//
// 100 은 settleProgress 가 analyzed 에서만 주는 값이라 여기서는 95를 넘지 않는다.
// 목록에서 연 세션은 영상 길이를 모르므로 그때만 이 값을 쓴다.
const ANALYSIS_SPAN_FALLBACK_MS = 30_000;

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
  const span =
    videoDurationMs !== null && videoDurationMs > 0
      ? videoDurationMs
      : ANALYSIS_SPAN_FALLBACK_MS;
  const filled = 80 * (clamp(elapsedMs, 0, span) / span);
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
