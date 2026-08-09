import type { PracticeSessionStatus } from "@/lib/api/v2/types";

// 구간 경계는 최우영 지정(2026-08-09). 폰에서 가장 오래 걸리는 단계가 압축인데
// 앞머리를 좁게 주면 그 시간 내내 막대가 기어가 "업로드가 느리다"로 읽힌다.
//   압축 있음(8MB 초과 + WebCodecs, 폰 원본 대부분): 압축 0→60 · 업로드 60→90 · 분석 90→99
//   압축 없음(노트북에서 고른 8MB 이하 파일):                업로드 0→60 · 분석 60→99
// 기기가 아니라 압축을 실제로 탔는지로 가른다 — 브라우저에 기기 신호가 없고,
// 노트북에서 큰 파일을 올리면 폰과 같은 일을 하기 때문이다.
// 압축 경로의 앞 두 구간은 40/80 → 60/90 으로 다시 넓혔다(2026-08-09, 폰 실사용 뒤).
export const COMPRESS_PROGRESS_END = 60;
export const UPLOAD_PROGRESS_END = 90;
export const UPLOAD_ONLY_PROGRESS_END = 60;
export const ANALYSIS_PROGRESS_LIMIT = 99;

// 분석 구간은 영상 길이에 비례해 채운다.
//   pct = min(99, 시작 + (99 − 시작) × 경과/영상길이)
//
// 고정 시간(180초·35초·30초로 2026-08-08에 세 번 틀렸다)이 아니라 영상 길이를 쓰는 근거는
// 실측이다 — dev 에서 47초 영상의 분석이 41.4초 걸렸다(영상 길이의 0.88배, 2026-08-08).
// 막대는 영상 길이와 같은 지점에서 99에 닿으므로, 그 비율이면 분석이 끝나는 순간
// 압축 경로 98% · 무압축 경로 94% 언저리이고 멈추는 구간이 없다.
//
// ⚠️ 분석이 영상 길이보다 오래 걸리면 99에서 멈춘 채로 기다린다.
// 그런 영상이 보이면 여기를 점근 곡선으로 바꾼다 — 시작 + (99 − 시작) × (1 − e^(−경과/(영상길이/2)))
// 이면 멈추지 않고, 위 실측 비율에서 86% 언저리에 닿는다.
//
// 100 은 settleProgress 가 analyzed 에서만 주는 값이라 여기서는 99를 넘지 않는다.
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
  const end = analysisStart(compressed);
  const ratio = clamp(percent, 0, 100) / 100;
  return start + ratio * (end - start);
}

// 분석 구간의 시작점 = 그 경로의 업로드가 끝나는 자리.
export function analysisStart(compressed: boolean): number {
  return compressed ? UPLOAD_PROGRESS_END : UPLOAD_ONLY_PROGRESS_END;
}

export function analysisProgress(
  elapsedMs: number,
  videoDurationMs: number | null,
  startPct: number,
): number {
  const span =
    videoDurationMs !== null && videoDurationMs > 0
      ? videoDurationMs
      : ANALYSIS_SPAN_FALLBACK_MS;
  const filled =
    (ANALYSIS_PROGRESS_LIMIT - startPct) * (clamp(elapsedMs, 0, span) / span);
  return Math.min(ANALYSIS_PROGRESS_LIMIT, startPct + filled);
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
