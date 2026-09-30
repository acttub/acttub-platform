import type { BlockageCategory } from "@/lib/practice/api-types";

export type BlockageKind = BlockageCategory;
export type BlockageSubBranch = "캐릭터 분석" | "대사 분석" | "그 외" | "감정" | "움직임" | "화술" | "표정";

export type BlockageChoice = {
  value: BlockageKind;
  /** 화면이 그리는 문장. 저장값을 제목 자리에 그대로 쓰면 배우가 "그 외"를 읽는다. */
  label: string;
  description: string;
};

/**
 * 한 화면이 통째로 드는 상태. 화면 전환이 없어 "지금 어느 단계인가"가 없다 —
 * 무엇이 남았는지는 kind 가 섰는지로만 갈린다.
 */
export type BlockageFlowState = {
  kind: BlockageKind | null;
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

export const initialBlockageFlowState: BlockageFlowState = {
  kind: null,
  detail: "",
};

export function chooseBlockageKind(
  state: BlockageFlowState,
  kind: BlockageKind,
): BlockageFlowState {
  if (state.kind === kind) return state;
  return { ...state, kind };
}

export function updateBlockageDetail(
  state: BlockageFlowState,
  detail: string,
): BlockageFlowState {
  return { ...state, detail };
}

/**
 * 대분류만 있으면 완성된다. 하위 갈래는 고르지 않으므로 늘 "그 외"로 간다 — DB 의 조합 CHECK
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
    sub_branch: "그 외",
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
