/**
 * 연기 이론 선택 — 준비 화면에서 "어떤 이론으로 볼까"를 고른다.
 *
 * id는 웹(`apps/web/src/features/practice/theory-choice.ts`)과 같은 값을 쓴다.
 * 아직 서버 계약(요청 바디)이 없어 전송하지 않고 수집·계측만 한다 — 웹도 같은 상태다.
 * 화면 라벨은 언어 파일(`theory.label.*`)에서 꺼낸다.
 */

export const THEORY_IDS = [
  'stanislavski',
  'hagen',
  'meisner',
  'chubbuck',
  'chekhov',
  // "none"은 "이론은 아무거나 좋다"는 명시적 답 — 아무것도 안 고른 무응답(null)과 다르다.
  'none',
] as const;

export type TheoryChoiceId = (typeof THEORY_IDS)[number];

/** 같은 칩을 다시 누르면 선택을 푼다(무응답으로 되돌린다). */
export function toggleTheoryChoice(
  current: TheoryChoiceId | null,
  next: TheoryChoiceId,
): TheoryChoiceId | null {
  return current === next ? null : next;
}
