/**
 * 오디션 공고의 찜·봤음 표시 (app.audition). 서버에 저장하지 않는다(스펙 「범위 밖」) — 이 브라우저의
 * localStorage뿐이다. 키는 모바일과 같은 이름을 쓴다. 저장소를 못 읽거나 못 써도(사생활 보호 창, 막힌
 * 사이트 데이터) 화면은 그대로 동작한다: 읽기 실패는 빈 집합, 쓰기 실패는 조용히 넘긴다.
 */

const KEYS = {
  starred: "acttub.auditions.starred",
  seen: "acttub.auditions.seen",
} as const;

/** 봤음은 계속 쌓이기만 하므로 최근 것만 남긴다. 공고는 마감 30일 뒤 서버에서 지워진다. */
const SEEN_LIMIT = 500;

export type AuditionMark = keyof typeof KEYS;

type MarkStorage = Pick<Storage, "getItem" | "setItem">;

function browserStorage(): MarkStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readMarks(
  mark: AuditionMark,
  storage: MarkStorage | null = browserStorage(),
): Set<string> {
  try {
    const raw = storage?.getItem(KEYS[mark]);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return new Set(
      Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [],
    );
  } catch {
    return new Set();
  }
}

export function writeMarks(
  mark: AuditionMark,
  ids: ReadonlySet<string>,
  storage: MarkStorage | null = browserStorage(),
): void {
  try {
    const list = [...ids];
    storage?.setItem(KEYS[mark], JSON.stringify(mark === "seen" ? list.slice(-SEEN_LIMIT) : list));
  } catch {
    // 저장 실패 — 이 탭이 열려 있는 동안은 화면 state로 유지된다.
  }
}
