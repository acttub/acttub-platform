/**
 * 오디션 공고의 찜·봤음 표시 (app.audition). 서버에 저장하지 않는다(스펙 「범위 밖」) — 기기 AsyncStorage뿐이다.
 * 저장소를 못 읽거나 못 써도 화면은 그대로 동작한다: 읽기 실패는 빈 목록, 쓰기 실패는 조용히 넘긴다.
 * (CI mobile 잡이 무설치 node --test 라 AsyncStorage 는 lazy require.)
 */

const STARRED_KEY = 'acttub.auditions.starred';
const SEEN_KEY = 'acttub.auditions.seen';

/** 봤음은 계속 쌓이기만 하므로 최근 것만 남긴다. 공고는 마감 30일 뒤 서버에서 지워진다. */
const SEEN_LIMIT = 500;

export type AuditionMark = 'starred' | 'seen';

type Storage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

function storage(): Storage {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('@react-native-async-storage/async-storage').default as Storage;
}

function keyOf(mark: AuditionMark): string {
  return mark === 'starred' ? STARRED_KEY : SEEN_KEY;
}

export async function readAuditionMarks(mark: AuditionMark): Promise<Set<string>> {
  try {
    const raw = await storage().getItem(keyOf(mark));
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

export async function writeAuditionMarks(mark: AuditionMark, ids: ReadonlySet<string>): Promise<void> {
  try {
    const list = [...ids];
    const kept = mark === 'seen' ? list.slice(-SEEN_LIMIT) : list;
    await storage().setItem(keyOf(mark), JSON.stringify(kept));
  } catch {
    // 저장 실패 — 이번 실행 동안은 화면 state로 유지된다.
  }
}
