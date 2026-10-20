/**
 * 「연습 1회」의 하나뿐인 기준(SOMA-773). 불꽃(연속일)·주간 원·「첫 연습 끝!」·프로필 이번 달 연습이 모두 이걸 쓴다.
 *
 * - 코칭: 노트가 생긴 회차. 대화만 하다 나간 회차는 세지 않는다.
 * - 리딩: 끝까지 읽은 회차(서버 status 'completed'). 앱은 인식된 대사가 없으면 완료를 보내지 않는다(readingRunCompleted).
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
 * 리딩 한 회차를 완료로 칠지(SOMA-773 #25). 끝까지 갔고, 인식된 내 대사가 한 줄 이상이어야 한다.
 * 이번 실행에서 말한 것(said)과, 이어하기 전에 서버가 이미 받은 인식(priorRecognized)을 함께 본다.
 * 아니면 완료 화면 문구·별점 요청·완료 저장(=연속일)을 하지 않는다.
 */
export function readingRunCompleted(input: {
  reachedEnd: boolean;
  said: Readonly<Record<string, string>>;
  priorRecognized?: boolean;
}): boolean {
  if (!input.reachedEnd) return false;
  if (input.priorRecognized) return true;
  return Object.values(input.said).some((text) => text.trim().length > 0);
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
