/**
 * 「연습 1회」의 하나뿐인 기준(SOMA-773). 불꽃(연속일)·주간 원·「첫 연습 끝!」·프로필 이번 달 연습이 모두 이걸 쓴다.
 *
 * - 코칭: 노트가 생긴 회차. 대화만 하다 나간 회차는 세지 않는다.
 * - 리딩: 대본(고른 구간) 끝까지 읽은 회차(서버 status 'completed'). 내 대사가 인식되지 않아도 끝까지 갔으면 완료다(10/25)
 *   — 마이크가 못 알아들었다고 연습을 안 한 게 아니다. 중간에 「그만하기」로 끝낸 회차는 세지 않는다(10/29).
 * - 챌린지: 올린 참여작 하나가 1회.
 *
 * 시각은 시작 시각이다(코칭 회차 created_at, 리딩 started_at, 참여작 created_at) — 자정을 넘긴 회차는 시작한 날로 센다.
 */

export type PracticeKind = 'coaching' | 'reading' | 'challenge';
export type CountedPractice = { kind: PracticeKind; at: string };

export type CountedPracticeInput = {
  groups?: readonly { practices: readonly { created_at: string; note: unknown }[] }[];
  readingSessions?: readonly { status: string; started_at: string }[];
  entries?: readonly { created_at: string }[];
};

export function countedPractices(input: CountedPracticeInput): CountedPractice[] {
  const out: CountedPractice[] = [];
  for (const group of input.groups ?? []) {
    for (const round of group.practices) if (round.note && round.created_at) out.push({ kind: 'coaching', at: round.created_at });
  }
  for (const session of input.readingSessions ?? []) {
    if (session.status === 'completed' && session.started_at) out.push({ kind: 'reading', at: session.started_at });
  }
  for (const entry of input.entries ?? []) if (entry.created_at) out.push({ kind: 'challenge', at: entry.created_at });
  return out;
}

/** 연속일·주간 원(practice-days)에 먹일 모양. */
export function countedPracticeDates(input: CountedPracticeInput): { created_at: string }[] {
  return countedPractices(input).map((p) => ({ created_at: p.at }));
}

/**
 * 리딩 한 회차를 완료로 칠지(SOMA-773 #25 → 10/25 사용자 결정). 끝까지 갔으면 완료다 — 인식된 내 대사가 없어도 센다.
 * (예전엔 인식된 대사가 한 줄 이상이어야 했다.) 중간에 그만한 회차는 내 대사를 한 줄도 못 읽었을 때만 부르는 쪽(play.tsx
 * stopUncounted)이 뺀다(10/29, readingStopCounted).
 * said·priorRecognized·recognition 은 부르는 쪽 호환으로 받기만 한다.
 */
export function readingRunCompleted(input: {
  reachedEnd: boolean;
  said?: Readonly<Record<string, string>>;
  priorRecognized?: boolean;
  recognition?: 'stt' | 'typing' | null;
}): boolean {
  return input.reachedEnd;
}

/** 중간에 「그만하기」로 끝내도 내 배역 대사를 이만큼 읽었으면 연습으로 센다(10/29 사용자 결정: 한 줄). */
export const READING_STOP_MIN_MY_LINES = 1;

/** 「그만하기」로 끝낸 회차를 연습으로 칠지 — 읽은 내 대사 줄 수로 본다. 상대 대사는 앱이 읽어 주므로 세지 않는다. */
export function readingStopCounted(myLinesRead: number): boolean {
  return myLinesRead >= READING_STOP_MIN_MY_LINES;
}

/** 이어하기 전 서버가 받은 인식이 있는지 — 녹음 전사나 원문 대조에 말한 것이 남아 있으면 있다. */
export function sessionHasRecognized(session: {
  recordings?: readonly { transcript: string | null }[];
  different_lines?: readonly { said: string | null }[];
}): boolean {
  return (
    (session.recordings ?? []).some((r) => !!r.transcript?.trim()) ||
    (session.different_lines ?? []).some((d) => !!d.said?.trim())
  );
}
