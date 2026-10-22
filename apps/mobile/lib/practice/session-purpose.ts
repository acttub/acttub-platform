import type { BlockageCategory } from './types.ts';

/**
 * 새 연습의 「오늘 세션 목적」(pen 「새 · 오늘 세션 목적」, SOMA-748).
 *
 * 서버에는 연습 목적 필드가 없다 — 세 갈래를 기존 막힘 큰 갈래로 옮겨 보낸다. 평가 받기는 막힘 미특정(그 외),
 * 막힌 곳 풀기는 표현, 인물 이해하기는 분석이다. 세부는 예전처럼 비워 보내 그 외가 된다(practice.start).
 */
export type SessionPurpose = 'review' | 'unblock' | 'character';

export const SESSION_PURPOSES: readonly SessionPurpose[] = ['review', 'unblock', 'character'];
export const DEFAULT_PURPOSE: SessionPurpose = 'review';

const CATEGORY: Record<SessionPurpose, BlockageCategory> = {
  review: '그 외',
  unblock: '표현',
  character: '분석',
};

export function blockageCategoryFor(purpose: SessionPurpose): BlockageCategory {
  return CATEGORY[purpose];
}

export function purposeFor(category: BlockageCategory | null): SessionPurpose {
  return SESSION_PURPOSES.find((p) => CATEGORY[p] === category) ?? DEFAULT_PURPOSE;
}

/**
 * 영상 없이 말로 코칭 받기의 목적(pen 「목적 · 영상 없이」, SOMA-745). 서버의 session_purpose 값 그대로 보낸다 —
 * 영상 없이 시작하면 서버가 이 목적으로 말로 하는 코치를 연다(practice.start). 막힌 곳 풀기가 기본 강조다.
 */
export type TalkPurpose = 'stuck' | 'character' | 'concern';

export const TALK_PURPOSES: readonly TalkPurpose[] = ['stuck', 'character', 'concern'];
export const DEFAULT_TALK_PURPOSE: TalkPurpose = 'stuck';

/** 준비 화면의 두 단계 — 목적 → 영상(권리 체크·시작 포함). 장면 단계는 없앴다(SOMA-778). */
export type UploadStep = 'purpose' | 'source';

/** 튜토리얼과 예시는 한 장(영상 단계)에서 영상·권리 체크·시작 버튼을 차례로 비추므로 바로 그 단계로 연다. */
export function firstUploadStep(input: { sample: boolean; tutorial: boolean }): UploadStep {
  return input.sample || input.tutorial ? 'source' : 'purpose';
}

/** 뒤로 가기가 돌아갈 단계. 첫 단계면 null — 화면을 닫는다. */
export function previousUploadStep(step: UploadStep): UploadStep | null {
  return step === 'source' ? 'purpose' : null;
}

export function stepperIndex(step: UploadStep): 1 | 2 {
  return step === 'purpose' ? 1 : 2;
}
