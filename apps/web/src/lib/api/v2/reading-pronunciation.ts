import { apiFetch } from "./client";
import type { PronunciationState } from "../../reading/pronunciation-report";

// 리딩 발음 보고서(SOMA-606, 실험). 서버가 OpenAPI 에 싣지 않는(@Hidden) 경로라 타입은 직접 둔다.
// 허용 밖이면 404 pronunciation_not_available. 처음 물으면 서버가 분석을 줄 세운다.
export async function getPronunciationReport(
  sessionId: string,
  options: { signal?: AbortSignal } = {},
): Promise<PronunciationState> {
  const { data } = await apiFetch<PronunciationState>(
    `/v2/reading/sessions/${encodeURIComponent(sessionId)}/pronunciation`,
    { signal: options.signal },
  );
  return data;
}
