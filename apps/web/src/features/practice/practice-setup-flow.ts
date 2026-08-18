import type { PracticeSessionRequest } from "@/lib/api/v2/types";

import type { BlockageSelection } from "./blockage-flow";

export type SceneContextDraft = {
  situation: string;
  characterContext: string;
  goal: string;
};

export function formatVideoDuration(durationMs: number | null): string | null {
  if (durationMs === null || !Number.isFinite(durationMs) || durationMs < 1) return null;
  const totalSeconds = Math.max(1, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}초`;
  if (seconds === 0) return `${minutes}분`;
  return `${minutes}분 ${seconds}초`;
}

export function buildPracticeSessionRequest(
  uploadIntentId: string,
  scene: SceneContextDraft,
  blockage: BlockageSelection,
  // 끝난 연습에서 "이어서 새 연습" 으로 왔다면 그 연습 — 코치가 그 연습의 대화를
  // 이어받는다. 없을 때 키 자체를 빼는 이유는 요청 지문이다: null 로 실으면 이 키가
  // 없던 시절의 지문과 갈려 같은 요청이 새 작업으로 취급된다.
  continuedFrom?: string,
): PracticeSessionRequest {
  return {
    upload_intent_id: uploadIntentId,
    situation: scene.situation.trim(),
    character_context: scene.characterContext.trim(),
    goal: scene.goal.trim(),
    ...blockage,
    ...(continuedFrom ? { continued_from: continuedFrom } : {}),
  };
}
