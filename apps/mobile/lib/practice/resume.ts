import { emptySceneDraft, type SceneDraft } from './start.ts';
import type { PracticeGroup } from './types.ts';

/**
 * 이어하기의 규칙(practice.resume, SOMA-672).
 *
 * 묶음에서 이어 가는 길은 둘이고 동시에 보이지 않는다.
 * - 「대화 이어 가기」: 묶음에 닫히지 않은 회차(열린 테이크)가 있을 때만. 그 회차의 대화로 바로 돌아간다.
 * - 「다음 테이크 찍기」: 열린 테이크가 없을 때만. 같은 묶음에 새 회차를 만들고, 영상은 언제나 새로 고르거나
 *   찍는다 — 지난 영상을 몰래 다시 쓰지 않는다(옛 영상이 필요하면 보관함에서 고른다).
 *
 * 앱에서 방금 끝낸 노트(A13)에서 이어갈 때만 이전 장면을 미리 채워 두고, 지난 기록(A1.2·A12)이나
 * 닫힌 코치 대화에서 이어갈 때는 장면을 비운다.
 */
export type ContinueOrigin =
  /** A13 연습 마치기 → 다음 테이크 찍기. 장면을 미리 채운다. */
  | { kind: 'note'; rootId: string; practiceId: string; scene: SceneDraft }
  /** A1.2 연습 기록 상세·A12 지난 노트·닫힌 코치 대화의 「다음 테이크 찍기」. 장면은 비운다. */
  | { kind: 'group'; rootId: string; practiceId: string }
  /** 리딩 마무리 「이 장면, 찍어서 코치에게 보여 주기」. 새 연습에 대본의 장면을 채운다(SOMA-772). */
  | { kind: 'reading'; scene: SceneDraft };

export type StartPlan = {
  /** 이어하기면 그 묶음, 새 연습이면 null. */
  continueFrom: { rootId: string; practiceId: string } | null;
  scene: SceneDraft;
  /** 장면을 미리 채웠는지 — 화면 제목·버튼 문구가 이걸 본다. */
  prefilled: boolean;
};

export function planFor(origin: ContinueOrigin | null): StartPlan {
  if (!origin) return { continueFrom: null, scene: emptySceneDraft, prefilled: false };
  if (origin.kind === 'reading') return { continueFrom: null, scene: { ...emptySceneDraft, ...origin.scene }, prefilled: false };
  const continueFrom = { rootId: origin.rootId, practiceId: origin.practiceId };
  if (origin.kind === 'note') return { continueFrom, scene: origin.scene, prefilled: true };
  return { continueFrom, scene: emptySceneDraft, prefilled: false };
}

/** 시작 버튼을 누를 수 있는 상태인지 — 새 연습이든 다음 테이크든 확정된 영상이 있어야 한다. */
export function canStart(pickedVideoId: string | null): boolean {
  return Boolean(pickedVideoId);
}

/** 묶음에서 이어 가는 버튼 하나. 열린 테이크가 있으면 그 대화로, 없으면 다음 테이크다. */
export type ContinueAction = { kind: 'resume'; practiceId: string } | { kind: 'nextTake' };

export function continueActionFor(group: Pick<PracticeGroup, 'in_progress_practice_id'> | null): ContinueAction {
  const open = group?.in_progress_practice_id;
  return open ? { kind: 'resume', practiceId: open } : { kind: 'nextTake' };
}

/** 버튼 문구 키 — 「대화 이어 가기」 / 「다음 테이크 찍기」. */
export function continueActionLabel(action: ContinueAction): 'history.resumeConversation' | 'history.nextTake' {
  return action.kind === 'resume' ? 'history.resumeConversation' : 'history.nextTake';
}
