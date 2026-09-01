import type { PracticeSessionRequest } from "@/lib/api/v2/types";

import type { BlockageSelection } from "./blockage-flow";

export type SceneContextDraft = {
  situation: string;
  characterContext: string;
  goal: string;
};

/**
 * 세 칸을 모두 비웠는가. Scene Context 는 선택 입력이고(ADR-021) 건너뛰기 버튼도,
 * 건너뛴 연습을 세는 것도 이 함수 하나를 본다 — 두 자리가 갈리면 버튼은 떴는데
 * 세지 않은 연습이 생긴다.
 *
 * 공백만 적은 것은 비운 것으로 본다. 요청 조립이 그것을 trim 해 빈 값으로 보내고
 * 서버도 isBlank 로 같이 본다.
 */
export function isSceneContextBlank(scene: SceneContextDraft): boolean {
  return (
    !scene.situation.trim() &&
    !scene.characterContext.trim() &&
    !scene.goal.trim()
  );
}

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
