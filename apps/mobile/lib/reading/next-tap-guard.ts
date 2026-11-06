/**
 * 리딩 [다음]의 두 번 누름 막기(11/5 문의 「대사가 씹힘」). 줄이 바뀌거나 지문 멈춤이 끝난 직후에는 [다음]을 받지 않는다 —
 * 앞 줄을 넘기려고 두 번 누른 손이 새로 시작한 상대 대사까지 건너뛰었다.
 */
export const NEXT_TAP_GUARD_MS = 600;

let guardMs = NEXT_TAP_GUARD_MS;

/** 화면 시험은 버튼을 연달아 누르므로 기본으로 끈다(tests/jest-setup). 막기 자체는 그 시험에서 다시 켜고 본다. */
export function setNextTapGuardMs(ms: number): void {
  guardMs = ms;
}

/** 줄이 보인 지 너무 얼마 안 됐는가. */
export function tooSoonAfterLineChange(shownAt: number, now: number = Date.now()): boolean {
  return now - shownAt < guardMs;
}
