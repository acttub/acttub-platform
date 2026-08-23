import type { PracticeSessionRequest } from "@/lib/api/v2/types";

export type BlockageKind = PracticeSessionRequest["blockage_kind"];
export type BlockageSubBranch = PracticeSessionRequest["sub_branch"];

export type BlockageChoice = {
  value: BlockageKind;
  description: string;
};

export type BlockageSubChoice = {
  value: BlockageSubBranch;
  description: string;
};

/**
 * 한 화면이 통째로 드는 상태. 화면 전환이 없어 "지금 어느 단계인가"가 없다 —
 * 무엇이 남았는지는 kind 가 섰는지로만 갈린다.
 */
export type BlockageFlowState = {
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
  // 갈아탄 대분류에는 앞서 고른 하위 갈래가 없다. 남겨 두면 그 목록에 없는 값이
  // 실려 나간다.
  return { ...state, kind, subBranch: null };
}

export function chooseBlockageSubBranch(
  state: BlockageFlowState,
  subBranch: BlockageSubBranch,
): BlockageFlowState {
  // "그 외"는 좁힐 것이 없어 하위 갈래 자리 자체가 서지 않는다.
  if (!state.kind || state.kind === "그 외") return state;
  return { ...state, subBranch };
}

/** 적어 둔 서술은 남긴다 — 대분류를 다시 고르는 것과 적은 것을 버리는 것은 다르다. */
export function changeBlockageKind(state: BlockageFlowState): BlockageFlowState {
  return { ...state, kind: null, subBranch: null };
}

export function updateBlockageDetail(
  state: BlockageFlowState,
  detail: string,
): BlockageFlowState {
  return { ...state, detail };
}

/**
 * 하위 갈래를 안 고른 사람에게 실리는 값. 화면의 제목·예시와 저장되는 값이 이 함수
 * 하나를 봐야 "화면은 그 외인데 저장은 다른 것"으로 갈리지 않는다.
 */
export function effectiveSubBranch(
  state: BlockageFlowState,
): BlockageSubBranch {
  return state.subBranch ?? "그 외";
}

/**
 * 대분류만 있으면 완성된다. 하위 갈래를 안 고르면 "그 외"로 간다 — DB 의 조합 CHECK
 * 제약이 빈 문자열을 거부하고 이 필드는 허용값 목록으로 막혀 있어 중립값을 새로
 * 만들 수 없는데, "그 외"가 이미 "특정하지 않음"을 뜻해 직접 고른 사람과 안 고른
 * 사람 모두에게 참이다(ADR-021).
 *
 * 대분류가 없으면 완성하지 않는다. 값이 동작을 가르기 때문이다 — "분석"일 때만
 * 대사 전사가 돌고, 코치 프롬프트와 노트 틀도 여기서 갈린다.
 */
export function completeBlockageFlow(state: BlockageFlowState): BlockageSelection | null {
  if (!state.kind) return null;
  return {
    blockage_kind: state.kind,
    sub_branch: effectiveSubBranch(state),
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
