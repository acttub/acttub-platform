import type { PracticeSessionStatus } from "@/lib/api/v2/types";

// 구간 경계는 최우영 지정(2026-08-09). 폰에서 가장 오래 걸리는 단계가 압축인데
// 앞머리를 좁게 주면 그 시간 내내 막대가 기어가 "업로드가 느리다"로 읽힌다.
//   압축 있음(8MB 초과 + WebCodecs, 폰 원본 대부분): 압축 0→80 · 업로드 80→90 · 분석 90→99
//   압축 없음(노트북에서 고른 8MB 이하 파일):                업로드 0→60 · 분석 60→99
// 기기가 아니라 압축을 실제로 탔는지로 가른다 — 브라우저에 기기 신호가 없고,
// 노트북에서 큰 파일을 올리면 폰과 같은 일을 하기 때문이다.
// 압축 경로의 앞 두 구간은 40/80 → 60/90 → 80/90 으로 넓혀 왔다(2026-08-09, 폰 실사용 뒤).
// 업로드가 10 밖에 안 되는 건 SOMA-334 로 업로드본이 50MB 에서 최대 13MB 로 줄어
// 이제 압축이 압도적으로 긴 구간이기 때문이다.
export const COMPRESS_PROGRESS_END = 80;
export const UPLOAD_PROGRESS_END = 90;
export const UPLOAD_ONLY_PROGRESS_END = 60;
export const ANALYSIS_PROGRESS_LIMIT = 99.5;

// 분석 구간은 영상 길이의 일정 비율까지 선형으로 채우고, 그 뒤에는 점근 곡선으로 잇는다.
//   경과 ≤ 채움 기간: 시작 + (95 − 시작) × 경과/채움 기간
//   경과 > 채움 기간: 95 + (99.5 − 95) × (1 − e^(−(경과−채움 기간)/채움 기간))
//
// 고정 시간(180초·35초·30초로 2026-08-08에 세 번 틀렸다)이 아니라 영상 길이를 쓰는 근거는
// 실측이다 — dev 에서 47초 영상의 분석이 41.4초 걸렸다(영상 길이의 0.88배, 2026-08-08).
//
// 비율 0.45 는 2026-08-09 폰 실사용에서 역산했다. 그때 막대는 채움 기간 = 영상 길이
// (비율 1.0)였는데 분석이 끝난 지점이 94% 였다 → 실제 분석 시간 = (94−90)/9 ≈ 영상 길이의
// 0.44배. 0.88배에서 절반으로 준 건 SOMA-334 로 업로드본이 서버 재압축 기준(15MB) 아래로
// 들어가 서버 ffmpeg 단계가 통째로 빠졌기 때문이다. 이 비율은 그대로 두고 정상 종료가 예상되는
// 채움 기간 끝을 95로 맞춰 대화로 넘어갈 때의 튐을 작게 한다. 순수 점근 곡선은 같은 시점에
// 구간의 63%밖에 채우지 못해 정상 종료 때 크게 뛴다.
const ANALYSIS_SPAN_RATIO = 0.45;
// 정상 종료 시점에는 95까지 채워 두되, 늦어지는 분석에도 계속 움직일 꼬리 구간을 남긴다.
const ANALYSIS_LINEAR_PROGRESS_END = 95;
// 99.5에는 도달하지 않고 가까워지기만 한다. 화면에서 반올림해도 analyzed 전에는 99로 보인다.
// 100은 settleProgress가 analyzed에서만 주는 값이다.
// 목록에서 연 세션은 영상 길이를 모르므로 그때만 이 값을 쓴다.
const ANALYSIS_SPAN_FALLBACK_MS = 30_000;

// SOMA-351에서 정한 목표 시간을 넘기면 멈춘 것으로 오해하지 않게 진행 중인 일을 다시 알린다.
export const ANALYSIS_DEADLINE_MS = 60_000;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// 압축 구간은 선형이 아니라 초반이 빠르고 후반이 느린 곡선으로 채운다(최우영 지정, 2026-08-09).
// 1 − (1 − x)² — 앞 4분의 1이 구간의 44%를 채우고 뒤 4분의 1은 6%만 채운다. 시작하자마자
// 눈에 띄게 움직여야 "멈춰 있다"로 읽히지 않고, 끝에서 천천히 가야 남은 폭을 다 쓰기 전에
// 압축이 끝난다.
const COMPRESS_EASE_EXPONENT = 2;

export function compressionProgress(ratio: number): number {
  const eased = 1 - (1 - clamp(ratio, 0, 1)) ** COMPRESS_EASE_EXPONENT;
  return eased * COMPRESS_PROGRESS_END;
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
      ? videoDurationMs * ANALYSIS_SPAN_RATIO
      : ANALYSIS_SPAN_FALLBACK_MS;
  const elapsed = Math.max(0, elapsedMs);
  if (elapsed <= span) {
    const filled =
      (ANALYSIS_LINEAR_PROGRESS_END - startPct) * (elapsed / span);
    return startPct + filled;
  }

  const tailElapsed = elapsed - span;
  const tailFilled =
    (ANALYSIS_PROGRESS_LIMIT - ANALYSIS_LINEAR_PROGRESS_END)
    * (1 - Math.exp(-tailElapsed / span));
  return ANALYSIS_LINEAR_PROGRESS_END + tailFilled;
}

export function isAnalysisPastDeadline(elapsedMs: number): boolean {
  return elapsedMs > ANALYSIS_DEADLINE_MS;
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
