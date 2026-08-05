import type { PracticeSessionRequest } from "@/lib/api/v2/types";

export type BlockageKind = PracticeSessionRequest["blockage_kind"];
export type BlockageSubBranch = PracticeSessionRequest["sub_branch"];
export type BlockageFlowStep = "main" | "sub" | "detail";

export type BlockageChoice = {
  value: BlockageKind;
  description: string;
};

export type BlockageSubChoice = {
  value: BlockageSubBranch;
  description: string;
};

export type BlockageFlowState = {
  step: BlockageFlowStep;
  kind: BlockageKind | null;
  subBranch: BlockageSubBranch | null;
  detail: string;
};

export type BlockageSelection = {
  blockage_kind: BlockageKind;
  sub_branch: BlockageSubBranch;
  blockage_detail: string | null;
};

export const BLOCKAGE_CHOICES: readonly BlockageChoice[] = [
  { value: "분석", description: "문제를 읽어내기 어려워요" },
  { value: "표현", description: "뜻은 알아도 안 나와요" },
  { value: "그 외", description: "다른 게 막혀 있어요" },
];

const SUB_BRANCH_CHOICES: Record<Exclude<BlockageKind, "그 외">, readonly BlockageSubChoice[]> = {
  분석: [
    { value: "캐릭터 분석", description: "인물이 왜 그러는지 모르겠어요" },
    { value: "대사 분석", description: "이 말을 왜 하는지 모르겠어요" },
    { value: "그 외", description: "다른 게 막혀요" },
  ],
  표현: [
    { value: "감정", description: "느낌이 안 올라와요" },
    { value: "움직임", description: "몸이 안 따라와요" },
    { value: "화술", description: "말이 안 실려요" },
    { value: "표정", description: "얼굴이 굳어요" },
    { value: "그 외", description: "다른 게 막혀요" },
  ],
};

const DETAIL_EXAMPLES: Record<BlockageSubBranch, readonly string[]> = {
  감정: [
    "어느 대목에서 감정이 멈추는지",
    "그때 어떤 감정을 내려고 했는지",
    "대신 무엇이 올라오는지",
  ],
  움직임: [
    "어느 대목에서 몸이 멈추는지",
    "그때 어떤 움직임을 하려 했는지",
    "대신 몸에 어떤 반응이 오는지",
  ],
  화술: [
    "어느 대목에서 말이 막히는지",
    "그때 어떤 뜻을 실어 말하려 했는지",
    "대신 목소리가 어떻게 나오는지",
  ],
  표정: [
    "어느 대목에서 얼굴이 굳는지",
    "그때 어떤 표정을 드러내려 했는지",
    "대신 얼굴에 무엇이 남는지",
  ],
  "캐릭터 분석": [
    "어느 대목에서 인물이 이해되지 않는지",
    "인물이 무엇을 원한다고 생각했는지",
    "어떤 행동이 특히 납득되지 않는지",
  ],
  "대사 분석": [
    "어느 대목의 말이 이해되지 않는지",
    "그 말로 무엇을 얻으려 했는지",
    "어떤 뜻으로 읽으면 어색해지는지",
  ],
  "그 외": [
    "어느 대목에서 막히는지",
    "그때 무엇을 하려 했는지",
    "대신 어떤 일이 생기는지",
  ],
};

export const initialBlockageFlowState: BlockageFlowState = {
  step: "main",
  kind: null,
  subBranch: null,
  detail: "",
};

export function subBranchChoices(kind: BlockageKind): readonly BlockageSubChoice[] {
  return kind === "그 외" ? [] : SUB_BRANCH_CHOICES[kind];
}

export function chooseBlockageKind(
  state: BlockageFlowState,
  kind: BlockageKind,
): BlockageFlowState {
  return {
    ...state,
    kind,
    subBranch: kind === "그 외" ? "그 외" : null,
    step: kind === "그 외" ? "detail" : "sub",
  };
}

export function chooseBlockageSubBranch(
  state: BlockageFlowState,
  subBranch: BlockageSubBranch,
): BlockageFlowState {
  if (!state.kind || state.kind === "그 외") return state;
  return { ...state, subBranch, step: "detail" };
}

export function changeBlockageKind(state: BlockageFlowState): BlockageFlowState {
  return { ...state, step: "main", kind: null, subBranch: null };
}

export function changeBlockageSubBranch(state: BlockageFlowState): BlockageFlowState {
  if (!state.kind || state.kind === "그 외") return changeBlockageKind(state);
  return { ...state, step: "sub", subBranch: null };
}

export function updateBlockageDetail(
  state: BlockageFlowState,
  detail: string,
): BlockageFlowState {
  return { ...state, detail };
}

export function completeBlockageFlow(state: BlockageFlowState): BlockageSelection | null {
  if (state.step !== "detail" || !state.kind || !state.subBranch) return null;
  return {
    blockage_kind: state.kind,
    sub_branch: state.subBranch,
    blockage_detail: state.detail.trim() || null,
  };
}

export function blockageDetailTitle(subBranch: BlockageSubBranch): string {
  return subBranch === "그 외"
    ? "막히는 지점이 어디까지인지 적어 주세요"
    : `${subBranch}이 어디까지 막히는지 적어 주세요`;
}

export function blockageDetailExamples(
  subBranch: BlockageSubBranch,
): readonly string[] {
  return DETAIL_EXAMPLES[subBranch];
}
