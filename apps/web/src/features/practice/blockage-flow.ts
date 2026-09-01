import type { PracticeSessionRequest } from "@/lib/api/v2/types";

export type BlockageKind = PracticeSessionRequest["blockage_kind"];
export type BlockageSubBranch = PracticeSessionRequest["sub_branch"];

export type BlockageChoice = {
  value: BlockageKind;
  /** 화면이 그리는 문장. 저장값을 제목 자리에 그대로 쓰면 배우가 "그 외"를 읽는다. */
  label: string;
  description: string;
};

export type BlockageSubChoice = {
  value: BlockageSubBranch;
  /** 대분류와 같은 이유로 라벨을 따로 든다 — "그 외"가 화면에 그대로 뜨면 안 된다. */
  label: string;
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

/**
 * 무엇이 막혔는지가 아니라 무엇을 도와줄지 묻는다 — 막히지 않은 배우가 문제를
 * 지어내야 했다(2026-08-25 배우 인터뷰, SOMA-454). 저장값은 그대로다: 값이
 * 동작을 가른다("분석"일 때만 대사 전사가 돌고 코치 프롬프트도 여기서 갈린다).
 */
export const BLOCKAGE_CHOICES: readonly BlockageChoice[] = [
  {
    value: "분석",
    label: "대사 분석",
    description: "이 말이 왜 지금 나오는지부터 같이 봐요",
  },
  {
    value: "표현",
    label: "연기 표현",
    description: "한 번에 하나씩 바꿔가며 해봐요",
  },
  {
    value: "그 외",
    label: "잘 모르겠어요",
    description: "영상에서 보이는 것부터 꺼내 드려요",
  },
];

/** 되돌리기 칩처럼 좁은 자리에 쓰는 짧은 이름. 라벨 문장은 칩에 들어가지 않는다. */
const KIND_SHORT_NAMES: Record<BlockageKind, string> = {
  분석: "장면·대사",
  표현: "표현",
  "그 외": "같이 찾기",
};

export function blockageKindShortName(kind: BlockageKind): string {
  return KIND_SHORT_NAMES[kind];
}

const SUB_BRANCH_CHOICES: Record<Exclude<BlockageKind, "그 외">, readonly BlockageSubChoice[]> = {
  분석: [
    { value: "캐릭터 분석", label: "인물", description: "인물이 무엇을 하려는지 같이 봐요" },
    { value: "대사 분석", label: "대사", description: "이 말이 왜 지금 나오는지 같이 봐요" },
    { value: "그 외", label: "아직 못 정했어요", description: "대화하면서 같이 찾아요" },
  ],
  표현: [
    { value: "감정", label: "감정", description: "느낌이 어디서 갈리는지 같이 봐요" },
    { value: "움직임", label: "움직임", description: "몸이 어디로 가는지 같이 봐요" },
    { value: "화술", label: "말", description: "말이 어떻게 실리는지 같이 봐요" },
    { value: "표정", label: "표정", description: "얼굴이 언제 달라지는지 같이 봐요" },
    { value: "그 외", label: "아직 못 정했어요", description: "대화하면서 같이 찾아요" },
  ],
};

/**
 * 상세 예시 한 벌. 하위 갈래마다 따로 두던 것을 접었다 — 갈래별 예시가 전부
 * "어디에서 막히는지"를 물어, 막히지 않은 배우에게 문제를 지어내게 했다.
 */
const DETAIL_EXAMPLES: readonly string[] = [
  "오늘 특히 확인하고 싶은 것",
  "이 장면에서 이미 정해 둔 것",
  "여러 번 해봤는데 잘 모르겠는 것",
];

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
  // 이미 고른 것을 다시 탭하는 것은 갈아타기가 아니다 — 준비 화면에 선택지가
  // 상시 떠 있어, 여기서 비우면 고른 하위 갈래가 소리 없이 사라진다.
  if (state.kind === kind) return state;
  // 갈아탄 대분류의 목록에 없는 값이 남을 수 있다("감정"은 분석의 선택지가 아니다).
  // 양쪽에 다 있는 "그 외"까지 함께 비우는 것은 그 하나를 가려내는 것보다,
  // 갈아탈 때마다 처음부터 고르는 편이 화면에서도 정직하기 때문이다.
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

/** 도움을 고르지 않았으면 서버가 이미 허용하는 중립값으로 요청값을 완성한다. */
export function completeBlockageFlowWithDefault(
  state: BlockageFlowState,
): BlockageSelection {
  return completeBlockageFlow(state) ?? {
    blockage_kind: "그 외",
    sub_branch: "그 외",
    blockage_detail: state.detail.trim() || null,
  };
}

export const BLOCKAGE_DETAIL_TITLE = "더 알려주고 싶은 게 있으면 적어 주세요";

export function blockageDetailExamples(): readonly string[] {
  return DETAIL_EXAMPLES;
}
