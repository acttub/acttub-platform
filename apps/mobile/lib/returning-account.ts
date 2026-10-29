/**
 * 이미 써 본 계정인가 — 처음 쓰는 사람용 안내(홈 「첫 연습 끝!」, 리딩 탭 「대본을 넣어 보세요」, 리딩 버튼 안내)를 건너뛸지 정한다.
 *
 * 안내를 본 기록은 기기에 남는다(lib/guide-state). 그래서 앱을 지웠다 다시 깔면 연습 기록이 많은 계정에도 첫 안내가 다시 떴다
 * (10/26 폰 확인 — 기록 62개 계정에 「첫 연습 끝! 잘했어요」, 대본 16개 계정에 「대본을 넣어 보세요」). 서버 기록으로 판단해
 * 이미 써 본 계정이면 안내를 띄우지 않고 본 것으로 남긴다.
 */

/** 홈 안내를 건너뛰는 「연습 1회」(lib/practice/counted) 수. 첫 연습 직후(1회)에는 그대로 띄운다. */
export const RETURNING_MIN_PRACTICES = 3;

/** 홈 — 「연습 1회」가 기준 이상 쌓였으면 첫 연습 안내를 띄우지 않는다. */
export function skipsHomeGuide(countedPracticeCount: number): boolean {
  return countedPracticeCount >= RETURNING_MIN_PRACTICES;
}

/** 챌린지 탭 첫 고르기 화면 — 참여작을 올린 적이 있거나 「연습 1회」가 기준 이상 쌓였으면 건너뛴다. */
export function skipsChallengeFirstPick(input: { entryCount: number; countedPracticeCount: number }): boolean {
  return input.entryCount > 0 || input.countedPracticeCount >= RETURNING_MIN_PRACTICES;
}

/**
 * 코칭 기록 상세 「이어서 연습할 수 있어요!」 — 같은 장면을 이어 찍은 적이 있거나(회차 2개 이상인 묶음) 「연습 1회」가 기준 이상
 * 쌓였으면 건너뛴다. 10/28 폰 확인 — 코칭 16번 한 계정에 다시 떴다.
 */
export function skipsGroupGuide(input: { countedPracticeCount: number; continuedBefore: boolean }): boolean {
  return input.continuedBefore || input.countedPracticeCount >= RETURNING_MIN_PRACTICES;
}

/** 리딩 탭 — 이미 올린 대본이 있으면 「대본을 넣어 보세요」를 띄우지 않는다. */
export function skipsReadingTabGuide(scriptCount: number): boolean {
  return scriptCount > 0;
}

/**
 * 리딩 버튼 안내 — 이어 읽는 회차이거나(진행 기록이 있다) 다른 대본을 읽어 본 적이 있으면 첫 리딩이 아니다.
 * 대본 목록을 못 읽었으면(null) 회차만 보고 정한다.
 */
export function skipsFirstReadingGuide(input: {
  resumed: boolean;
  scriptId: string | null | undefined;
  scripts: readonly { id: string; last_practiced_at: string | null }[] | null;
}): boolean {
  if (input.resumed) return true;
  return (input.scripts ?? []).some((s) => s.id !== input.scriptId && !!s.last_practiced_at);
}
