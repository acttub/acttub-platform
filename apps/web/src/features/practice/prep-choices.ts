import type { PracticeSessionRequest } from "@/lib/api/v2/types";

export type BlockageKind = PracticeSessionRequest["blockage_kind"];
export type BlockageSubBranch = PracticeSessionRequest["sub_branch"];

export type BlockageSelection = {
  blockage_kind: BlockageKind;
  sub_branch: BlockageSubBranch;
  blockage_detail: string | null;
};

/**
 * 어떤 연습에서 이 장면을 찍고 있는가 (M4 레퍼런스). 서버 계약에 자리가 없어
 * 계측(practice_session_created.practice_purpose)에만 실린다 — 이론 칩(SOMA-473)과
 * 같은 방식으로, 계약이 서면 그대로 요청에 싣는다.
 */
export const PURPOSE_CHOICES = [
  { id: "admissions", label: "입시 준비" },
  { id: "regular", label: "정기 촬영" },
  { id: "audition", label: "오디션 준비" },
] as const;

export type PurposeChoiceId = (typeof PURPOSE_CHOICES)[number]["id"];

export function togglePurposeChoice(
  current: PurposeChoiceId | null,
  next: PurposeChoiceId,
): PurposeChoiceId | null {
  return current === next ? null : next;
}

export type DifficultyChoice = {
  id: string;
  /** 배우의 말로 된 선택지 문장. 이 문장이 blockage_detail 로 코치에게 그대로 간다. */
  label: string;
  kind: BlockageKind;
  subBranch: BlockageSubBranch;
};

/**
 * 어떤 어려움이 가장 크게 느껴졌는가 (M4 레퍼런스). 도구 분류("분석/표현" 2단계)
 * 대신 배우의 말 한 단계로 받고, 저장은 기존 서버 허용값 조합으로 옮긴다 —
 * API 계약 무변경. 값이 동작을 가른다("분석"일 때만 대사 전사가 돈다)는 사실은
 * 그대로라, 다섯 문장 모두 연기 표현의 어려움이므로 "표현" 밑으로 보낸다.
 */
export const DIFFICULTY_CHOICES = [
  { id: "emotion", label: "감정이 안 올라와요", kind: "표현", subBranch: "감정" },
  { id: "gaze", label: "시선이 흔들려요", kind: "표현", subBranch: "표정" },
  { id: "line-rush", label: "대사가 급해요", kind: "표현", subBranch: "화술" },
  { id: "partner", label: "상대 반응을 못 들어요", kind: "표현", subBranch: "그 외" },
  { id: "movement", label: "동작이 어색해요", kind: "표현", subBranch: "움직임" },
] as const satisfies readonly DifficultyChoice[];

export type DifficultyChoiceId = (typeof DIFFICULTY_CHOICES)[number]["id"];

export function toggleDifficultyChoice(
  current: DifficultyChoiceId | null,
  next: DifficultyChoiceId,
): DifficultyChoiceId | null {
  return current === next ? null : next;
}

/**
 * 고른 어려움을 요청값으로 완성한다. 안 고르면 서버가 이미 허용하는 중립값
 * "그 외"/"그 외"로 간다(ADR-021과 같은 근거 — "특정하지 않음"은 안 고른 사람에게도
 * 참이다). 고르면 문장 라벨을 blockage_detail 로 실어 코치가 배우가 고른 말
 * 그대로를 본다.
 */
export function difficultySelection(
  choiceId: DifficultyChoiceId | null,
): BlockageSelection {
  const choice = DIFFICULTY_CHOICES.find((item) => item.id === choiceId);
  if (!choice) {
    return { blockage_kind: "그 외", sub_branch: "그 외", blockage_detail: null };
  }
  return {
    blockage_kind: choice.kind,
    sub_branch: choice.subBranch,
    blockage_detail: choice.label,
  };
}
