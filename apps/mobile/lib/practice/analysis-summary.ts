import type { PracticeAnalysis } from './types.ts';

/**
 * 코치 화면 위 「AI가 본 장면 · …」 한 줄(SOMA-778). 분석 공개 요약 중 신형(VideoRecordSummaryResponse)의
 * observed_scene 첫 문장을 한 줄로 만든다. 옛 갈래·빈 값·모르는 모양이면 null — 화면은 줄을 숨긴다.
 */
export function observedSceneLine(analysis: PracticeAnalysis | null | undefined): string | null {
  const summary = analysis?.summary;
  if (!summary || typeof summary !== 'object') return null;
  const observed = (summary as { observed_scene?: unknown }).observed_scene;
  if (!Array.isArray(observed)) return null;
  for (const item of observed) {
    if (typeof item !== 'string') continue;
    const line = item.replace(/\s+/g, ' ').trim();
    if (line) return line;
  }
  return null;
}
