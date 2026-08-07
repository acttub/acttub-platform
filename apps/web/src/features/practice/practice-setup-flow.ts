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
): PracticeSessionRequest {
  return {
    upload_intent_id: uploadIntentId,
    situation: scene.situation.trim(),
    character_context: scene.characterContext.trim(),
    goal: scene.goal.trim(),
    ...blockage,
  };
}
