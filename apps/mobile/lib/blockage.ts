/**
 * 받고 싶은 도움 고르기 — 대분류 → 세부 → 상세 3단계.
 *
 * 서버가 이 선택으로 코치를 가른다(분석 코치 / 표현 코치). 예전처럼 '그 외'를 박아
 * 보내면 분기가 아예 안 걸려서 배우가 뭘 물어봐야 하는지와 무관한 질문이 나온다.
 *
 * 선택지와 단계 규칙은 웹(`apps/web/src/features/practice/blockage-flow.ts`)과
 * 같은 값을 쓴다. 두 플랫폼이 다른 선택지를 보내면 서버 분기가 갈라진다.
 */

export type BlockageKind = '분석' | '표현' | '그 외';
export type BlockageSubBranch =
  | '캐릭터 분석'
  | '대사 분석'
  | '감정'
  | '움직임'
  | '화술'
  | '표정'
  | '그 외';
export type BlockageFlowStep = 'main' | 'sub' | 'detail';

export type BlockageChoice = {
  value: BlockageKind;
  /** 화면이 그리는 문장. 저장값을 제목 자리에 그대로 쓰면 배우가 '그 외'를 읽는다. */
  label: string;
  description: string;
};
export type BlockageSubChoice = { value: BlockageSubBranch; description: string };

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

/**
 * 무엇이 막혔는지가 아니라 무엇을 도와줄지 묻는다 — 막히지 않은 배우가 문제를
 * 지어내야 했다(2026-08-25 배우 인터뷰, SOMA-454). 저장값은 그대로다.
 * 웹(`apps/web/src/features/practice/blockage-flow.ts`)과 글자까지 같아야 한다.
 */
export const BLOCKAGE_CHOICES: readonly BlockageChoice[] = [
  {
    value: '분석',
    label: '장면과 대사를 더 파고들고 싶어요',
    description: '이 말이 왜 지금 나오는지부터 같이 봐요',
  },
  {
    value: '표현',
    label: '표현이 생각한 대로 안 나와요',
    description: '한 번에 하나씩 바꿔가며 해봐요',
  },
  {
    value: '그 외',
    label: '잘 모르겠어요 — 못 본 걸 짚어 주세요',
    description: '영상에서 보이는 것부터 꺼내 드려요',
  },
];

/** 되돌리기 칩처럼 좁은 자리에 쓰는 짧은 이름. 라벨 문장은 칩에 들어가지 않는다. */
const KIND_SHORT_NAMES: Record<BlockageKind, string> = {
  분석: '장면·대사',
  표현: '표현',
  '그 외': '같이 찾기',
};

export function blockageKindShortName(kind: BlockageKind): string {
  return KIND_SHORT_NAMES[kind];
}

const SUB_BRANCH_CHOICES: Record<
  Exclude<BlockageKind, '그 외'>,
  readonly BlockageSubChoice[]
> = {
  분석: [
    { value: '캐릭터 분석', description: '인물이 무엇을 하려는지 같이 봐요' },
    { value: '대사 분석', description: '이 말이 왜 지금 나오는지 같이 봐요' },
    { value: '그 외', description: '아직 좁히지 않을래요' },
  ],
  표현: [
    { value: '감정', description: '느낌이 어디서 갈리는지 같이 봐요' },
    { value: '움직임', description: '몸이 어디로 가는지 같이 봐요' },
    { value: '화술', description: '말이 어떻게 실리는지 같이 봐요' },
    { value: '표정', description: '얼굴이 언제 달라지는지 같이 봐요' },
    { value: '그 외', description: '아직 좁히지 않을래요' },
  ],
};

/**
 * 상세 예시 한 벌. 하위 갈래마다 따로 두던 것을 접었다 — 갈래별 예시가 전부
 * '어디에서 막히는지'를 물어, 막히지 않은 배우에게 문제를 지어내게 했다.
 */
const DETAIL_EXAMPLES: readonly string[] = [
  '오늘 특히 확인하고 싶은 것',
  '이 장면에서 이미 정해 둔 것',
  '여러 번 해봤는데 잘 모르겠는 것',
];

export const initialBlockageFlowState: BlockageFlowState = {
  step: 'main',
  kind: null,
  subBranch: null,
  detail: '',
};

export function subBranchChoices(kind: BlockageKind): readonly BlockageSubChoice[] {
  return kind === '그 외' ? [] : SUB_BRANCH_CHOICES[kind];
}

/** '그 외'는 좁힐 게 없어 세부 단계를 건너뛰고 바로 상세로 간다. */
export function chooseBlockageKind(
  state: BlockageFlowState,
  kind: BlockageKind,
): BlockageFlowState {
  return {
    ...state,
    kind,
    subBranch: kind === '그 외' ? '그 외' : null,
    step: kind === '그 외' ? 'detail' : 'sub',
  };
}

export function chooseBlockageSubBranch(
  state: BlockageFlowState,
  subBranch: BlockageSubBranch,
): BlockageFlowState {
  if (!state.kind || state.kind === '그 외') return state;
  return { ...state, subBranch, step: 'detail' };
}

export function changeBlockageKind(state: BlockageFlowState): BlockageFlowState {
  return { ...state, step: 'main', kind: null, subBranch: null };
}

export function changeBlockageSubBranch(state: BlockageFlowState): BlockageFlowState {
  if (!state.kind || state.kind === '그 외') return changeBlockageKind(state);
  return { ...state, step: 'sub', subBranch: null };
}

export function updateBlockageDetail(
  state: BlockageFlowState,
  detail: string,
): BlockageFlowState {
  return { ...state, detail };
}

/** 상세 단계까지 왔고 두 선택이 다 찼을 때만 값을 낸다. 상세는 비워도 된다. */
export function completeBlockageFlow(
  state: BlockageFlowState,
): BlockageSelection | null {
  if (state.step !== 'detail' || !state.kind || !state.subBranch) return null;
  return {
    blockage_kind: state.kind,
    sub_branch: state.subBranch,
    blockage_detail: state.detail.trim() || null,
  };
}

export const BLOCKAGE_DETAIL_TITLE = '더 알려주고 싶은 게 있으면 적어 주세요';

export function blockageDetailExamples(): readonly string[] {
  return DETAIL_EXAMPLES;
}
