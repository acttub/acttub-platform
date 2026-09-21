import type { PracticeCreateRequest } from "@/lib/practice/api-types";

import type { BlockageSelection } from "./blockage-flow";

export type SceneContextDraft = {
  situation: string;
  characterContext: string;
  goal: string;
};

/** Scene Context 세 칸은 각 300자, 막힘 서술은 500자까지다(서버는 넘으면 422). */
export const SCENE_FIELD_MAX = 300;
export const BLOCKAGE_NOTE_MAX = 500;

export function sceneContextTooLong(scene: SceneContextDraft): boolean {
  return [scene.situation, scene.characterContext, scene.goal].some((v) => Array.from(v.trim()).length > SCENE_FIELD_MAX);
}

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

/**
 * 회차 시작 요청 본문(요청 id 는 부르는 쪽이 붙인다). 상황·인물·목표는 공백을 정리해 빈 값이면 빈 문자열로
 * 보낸다 — 자리표시자를 채우지 않는다(ADR-021). 막힘은 화면의 저장값 그대로다. client_experience 는 웹의 계약
 * 판(three_layers_v1)이고, 무입력 조건에서만 신형이 되는 것은 서버가 정한다(practice.start).
 */
export function buildPracticeRequest(
  videoId: string,
  scene: SceneContextDraft,
  blockage: BlockageSelection,
): Omit<PracticeCreateRequest, "request_id"> {
  return {
    video_id: videoId,
    scene: {
      situation: scene.situation.trim(),
      character: scene.characterContext.trim(),
      goal: scene.goal.trim(),
    },
    blockage: {
      category: blockage.blockage_kind,
      detail: blockage.sub_branch,
      note: blockage.blockage_detail,
    },
    client_experience: "three_layers_v1",
  };
}
