import { firstUseOwnerReady } from '../practice/first-use-graduation.ts';

/**
 * 첫 리딩(10/29) — 리딩을 한 번도 끝까지 해 보지 않은 계정. 이 사람에게는 대본을 넣자마자 대본 상세·목소리·구간을 건너뛰고
 * 「누구 대사를 읽을까요?」 하나만 물은 뒤 처음부터 끝까지 읽게 한다. 읽는 중에는 위 「그만 읽기」로 언제든 첫 리딩 끝 화면으로 간다.
 *
 * 판단: 이 기기에 계정별로 남긴 「끝까지 읽었다」 표시가 있거나, 서버 대본 목록에 마지막 회차가 완료인 대본이 하나라도 있으면 끝낸 사람이다.
 * 확인을 못 하면(네트워크 실패 등) 끝낸 사람으로 보고 기존 흐름을 그대로 쓴다 — 기존 사용자를 첫 흐름에 잘못 넣지 않게.
 *
 * ⚠️ 네이티브 모듈이 없는 환경(Node 테스트)에서도 불러올 수 있게 저장소는 함수 안 require 로만 닿는다.
 */
type Storage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};
function storage(): Storage {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('@react-native-async-storage/async-storage').default as Storage;
}
const keyFor = (userId: string) => `acttub.reading.finishedOnce.${userId}`;
/** 계정 id — 못 얻으면 null(로그인 전·저장소 없음). 여기서 실패해도 리딩 흐름은 막지 않는다. */
async function ownerId(): Promise<string | null> {
  try {
    return await firstUseOwnerReady(1500);
  } catch {
    return null;
  }
}

/** 서버 대본 목록만으로 본 판단 — 마지막 회차가 완료인 대본이 있으면 끝까지 읽어 본 사람이다. */
export function finishedFromScripts(scripts: readonly { status: string }[]): boolean {
  return scripts.some((s) => s.status === 'completed');
}

/**
 * 리딩을 끝까지 해 본 적이 있나. `listScripts` 는 서버 대본 목록(api.listReadingScripts).
 * 로컬 표시 → 서버 목록 순으로 보고, 서버에서 확인되면 로컬에도 남긴다.
 */
export async function hasFinishedReading(
  listScripts: () => Promise<{ scripts: readonly { status: string }[] }>,
  store: Storage = storage(),
): Promise<boolean> {
  const id = await ownerId();
  if (id) {
    try {
      if ((await store.getItem(keyFor(id))) === '1') return true;
    } catch {
      // 못 읽으면 서버로 본다.
    }
  }
  try {
    const { scripts } = await listScripts();
    const finished = finishedFromScripts(scripts);
    if (finished && id) void store.setItem(keyFor(id), '1').catch(() => {});
    return finished;
  } catch {
    return true;
  }
}

/** 리딩을 마지막 줄까지 가 본 순간 부른다. */
export async function markReadingFinished(store: Storage = storage()): Promise<void> {
  const id = await ownerId();
  if (!id) return;
  try {
    await store.setItem(keyFor(id), '1');
  } catch {
    // 못 적으면 다음에 서버 목록으로 다시 판단한다.
  }
}

/** 첫 리딩으로 시작한 회차 — 배역 고르기(R8 첫 모드)가 시작할 때 적고, 실행 화면이 「그만 읽기」·끝 화면을 정할 때 읽는다. */
let firstSessionId: string | null = null;
export function setFirstReadingSession(sessionId: string | null): void {
  firstSessionId = sessionId;
}
export function isFirstReadingSession(sessionId: string | null | undefined): boolean {
  return !!sessionId && sessionId === firstSessionId;
}

/** 첫 리딩이면 대본을 넣은 뒤 바로 가는 곳 — 배역만 고르는 R8 첫 모드. */
export const FIRST_READING_HREF = { pathname: '/reading/range', params: { first: '1' } } as const;
