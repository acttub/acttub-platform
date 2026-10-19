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

/** 준비 화면의 세 단계 — 목적 → 영상 고르기 → 장면·질문 받기. */
export type UploadStep = 'purpose' | 'source' | 'scene';

/** 튜토리얼과 예시는 한 장(장면 단계)에서 영상·적을 칸·시작 버튼을 차례로 비추므로 바로 그 단계로 연다. */
export function firstUploadStep(input: { sample: boolean; tutorial: boolean }): UploadStep {
  return input.sample || input.tutorial ? 'scene' : 'purpose';
}

/** 뒤로 가기가 돌아갈 단계. 첫 단계면 null — 화면을 닫는다. */
export function previousUploadStep(step: UploadStep): UploadStep | null {
  if (step === 'scene') return 'source';
  if (step === 'source') return 'purpose';
  return null;
}

export function stepperIndex(step: UploadStep): 1 | 2 | 3 {
  return step === 'purpose' ? 1 : step === 'source' ? 2 : 3;
}
