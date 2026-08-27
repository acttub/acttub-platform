/**
 * 막히는 지점 고르기 — 대분류 → 세부 → 상세 3단계.
 *
 * 서버가 이 선택으로 코치를 가른다(분석 코치 / 표현 코치). 예전처럼 '그 외'를 박아
 * 보내면 분기가 아예 안 걸려서 배우가 뭘 물어봐야 하는지와 무관한 질문이 나온다.
 *
 * 선택지와 단계 규칙은 웹(`apps/web/src/features/practice/blockage-flow.ts`)과
 * 같은 값을 쓴다. 두 플랫폼이 다른 선택지를 보내면 서버 분기가 갈라진다.
 */

import { translate, translateList } from './i18n.ts';

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

export type BlockageChoice = { value: BlockageKind; description: string };
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

export const BLOCKAGE_CHOICES: readonly BlockageChoice[] = (
  ['분석', '표현', '그 외'] as const
).map((value) => ({ value, description: translate(`blockage.kindDesc.${value}`) }));

const subChoice = (value: BlockageSubBranch): BlockageSubChoice => ({
  value,
  description: translate(`blockage.subDesc.${value}`),
});

const SUB_BRANCH_CHOICES: Record<
  Exclude<BlockageKind, '그 외'>,
  readonly BlockageSubChoice[]
> = {
  분석: (['캐릭터 분석', '대사 분석', '그 외'] as const).map(subChoice),
  표현: (['감정', '움직임', '화술', '표정', '그 외'] as const).map(subChoice),
};

const SUB_BRANCHES = ['감정', '움직임', '화술', '표정', '캐릭터 분석', '대사 분석', '그 외'] as const;

const DETAIL_EXAMPLES: Record<BlockageSubBranch, readonly string[]> = Object.fromEntries(
  SUB_BRANCHES.map((branch) => [branch, translateList(`blockage.detailQ.${branch}`)]),
) as unknown as Record<BlockageSubBranch, readonly string[]>;

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

/** 막힘 선택을 건너뛰면 보내는 값 — 서버 기본 분기('그 외')와 같다(SOMA-432). */
export function skippedBlockageSelection(): BlockageSelection {
  return { blockage_kind: '그 외', sub_branch: '그 외', blockage_detail: null };
}

export function blockageDetailTitle(subBranch: BlockageSubBranch): string {
  return subBranch === '그 외'
    ? translate('blockage.detailPromptOther')
    : translate('blockage.detailPrompt', {
        label: translate(`blockage.kindLabel.${subBranch}`),
      });
}

export function blockageDetailExamples(
  subBranch: BlockageSubBranch,
): readonly string[] {
  return DETAIL_EXAMPLES[subBranch];
}
