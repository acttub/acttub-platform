/**
 * 촬영 화면 아래에서 고르는 용도 (SOMA-494).
 *
 * <p>가운데 촬영 버튼은 카메라를 바로 연다(인스타 만들기 화면처럼). 무엇을 위해 찍는지는 셔터 아래
 * 줄을 옆으로 넘겨 고른다 — 고른 용도에 따라 찍은 뒤 가는 곳이 다르다.
 * <ul>
 *   <li>ai — 보관함에 두고 새 연습 준비로(AI 코칭)
 *   <li>challenge — 오늘의 대사를 띄우고 60초 안에 찍어 챌린지 올리기로
 *   <li>plain — 보관함에 저장만
 * </ul>
 * 대사 챌린지는 한국어로 쓰는 사람에게만 연다(SOMA-544).
 */
export type RecordMode = 'ai' | 'challenge' | 'plain';

export function recordModes(korean: boolean): RecordMode[] {
  return korean ? ['ai', 'challenge', 'plain'] : ['ai', 'plain'];
}

/** 왼쪽으로 넘기면 다음, 오른쪽으로 넘기면 이전. 끝에서는 그대로다. */
export function recordModeAfterSwipe(
  modes: readonly RecordMode[],
  current: RecordMode,
  direction: 'left' | 'right',
): RecordMode {
  const at = Math.max(0, modes.indexOf(current));
  const next = direction === 'left' ? Math.min(modes.length - 1, at + 1) : Math.max(0, at - 1);
  return modes[next];
}
