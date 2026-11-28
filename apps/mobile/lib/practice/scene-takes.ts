/**
 * 연습 탭의 대본별 단계(① 대사 익히기 → ② 촬영하기 → ③ 코칭 받기) — 앱에서만 판정한다(서버 변경 없음, 첫 판).
 *
 * - ① 리딩은 서버 대본 카드의 status·last_practiced_at 으로 안다(진행 중 회차 = 익히는 중, 마지막 회차 completed = 끝).
 * - ②③은 서버에 대본별 값이 없어 이 기기에 계정별로 남긴다: 대본 id → 마지막으로 찍은 장면 영상(보관함 대기 id·확정 id)과
 *   찍은 시각, 그 대본(또는 그 영상)으로 코칭을 시작한 시각.
 *   ⚠️ 한계: 기기를 바꾸거나 앱을 지웠다 깔면 ②③ 표시는 비고 ①만 남는다. 다른 기기에서 찍은 장면도 모른다.
 *
 * 뒤에 한 일이 앞 단계를 덮는다 — 코칭 뒤에 다시 리딩을 끝내면 다시 「찍을 차례」다(시각 비교, 서버·기기 시계 차이는 감수).
 *
 * ⚠️ 네이티브 모듈이 없는 환경(Node 테스트)에서도 불러올 수 있게 저장소는 함수 안 require 로만 닿는다.
 */
import { deviceStorage, type DeviceStorage } from '../device-storage.ts';

type Storage = Pick<DeviceStorage, 'getItem' | 'setItem'>;

export const sceneTakesKey = (owner: string) => `acttub.sceneTakes.${owner}`;

export type SceneTake = {
  /** 마지막으로 찍은 장면 영상 — 보관함 대기 항목 id(확정 전), 확정된 영상 id(알면), 기기 복사본, 길이. */
  pendingId?: string | null;
  videoId?: string | null;
  uri?: string | null;
  durationMs?: number | null;
  /** 찍은 시각(ms). 리딩 끝에서 바로 코칭을 시작했으면 찍은 기록 없이 coachedAt 만 있다. */
  takenAt?: number;
  /** 이 대본(또는 위 영상)으로 코칭을 시작한 시각(ms). */
  coachedAt?: number;
  /** 코칭 묶음을 알면(리딩 끝 말로 코칭은 바로 생긴다) 그 묶음 id — 코치 메모를 정확히 찾는다. */
  coachRootId?: string | null;
};

export type SceneTakes = Record<string, SceneTake>;

function storage(): Storage | null {
  try {
    return deviceStorage() ?? null;
  } catch {
    return null;
  }
}

/** 이번 실행에서 읽거나 쓴 값(계정별). 화면이 기기를 다시 읽기 전에 바로 그린다. */
const known = new Map<string, SceneTakes>();

export function knownSceneTakes(owner: string | null | undefined): SceneTakes | null {
  return owner ? (known.get(owner) ?? null) : null;
}

export async function loadSceneTakes(owner: string | null | undefined, store: Storage | null = storage()): Promise<SceneTakes> {
  if (!owner) return {};
  const cached = known.get(owner);
  if (cached) return cached;
  let takes: SceneTakes = {};
  try {
    const text = await store?.getItem(sceneTakesKey(owner));
    const parsed: unknown = text ? JSON.parse(text) : null;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) takes = parsed as SceneTakes;
  } catch {
    // 못 읽으면 ②③을 모르는 채로 ①만 보인다.
  }
  known.set(owner, takes);
  return takes;
}

async function update(owner: string | null | undefined, scriptId: string, change: (was: SceneTake | undefined) => SceneTake, store: Storage | null): Promise<SceneTakes> {
  if (!owner || !scriptId) return {};
  const all = { ...(await loadSceneTakes(owner, store)) };
  all[scriptId] = change(all[scriptId]);
  known.set(owner, all);
  try {
    await store?.setItem(sceneTakesKey(owner), JSON.stringify(all));
  } catch {
    // 못 남겨도 이번 실행 동안은 보인다.
  }
  return all;
}

/** 「촬영하기」로 장면을 찍어 보관함에 넣었다. 그 전의 코칭 표시는 지운다 — 새 영상은 아직 코칭 전이다. */
export function recordSceneTake(
  owner: string | null | undefined,
  scriptId: string,
  take: { pendingId: string | null; videoId?: string | null; uri: string | null; durationMs: number | null },
  now = Date.now(),
  store: Storage | null = storage(),
): Promise<SceneTakes> {
  return update(owner, scriptId, () => ({ ...take, takenAt: now }), store);
}

/** 이 대본으로 코칭을 시작했다(찍은 영상 보여 주기·리딩 끝 코칭). */
export function markSceneCoached(
  owner: string | null | undefined,
  scriptId: string,
  coachRootId: string | null = null,
  now = Date.now(),
  store: Storage | null = storage(),
): Promise<SceneTakes> {
  return update(owner, scriptId, (was) => ({ ...was, coachedAt: now, coachRootId }), store);
}

/** 테스트 전용. */
export function resetSceneTakesForTest(): void {
  known.clear();
}

/**
 * 대본 하나의 지금 단계.
 * - reading: 리딩 중(진행 중 회차) → 이어서 읽기
 * - read: 리딩을 끝냈고 그 뒤로 안 찍음 → 이 장면 찍기
 * - shot: 찍었고 코칭 전 → 코칭 받기
 * - coached: 코칭까지 → 다시 읽기
 * - null: 배역을 고른 적도, 찍은 적도 없다(새 대본)
 */
export type PracticeStep = 'reading' | 'read' | 'shot' | 'coached';

type StepScript = { status: 'reading' | 'completed' | 'no_cast'; last_practiced_at: string | null };

function ms(iso: string | null | undefined): number {
  const n = Date.parse(iso ?? '');
  return Number.isNaN(n) ? 0 : n;
}

function takeAt(take: SceneTake | undefined): number {
  return Math.max(take?.takenAt ?? 0, take?.coachedAt ?? 0);
}

export function practiceStepOf(script: StepScript, take: SceneTake | undefined): PracticeStep | null {
  const readAt = ms(script.last_practiced_at);
  const tookAt = takeAt(take);
  if (tookAt > 0 && tookAt >= readAt) return (take?.coachedAt ?? 0) >= (take?.takenAt ?? 0) ? 'coached' : 'shot';
  if (script.status === 'reading') return 'reading';
  if (script.status === 'completed') return 'read';
  return null;
}

/** 마지막으로 다룬 대본 — 리딩한 시각과 이 기기에서 찍거나 코칭한 시각 중 가장 늦은 것. 단계가 없는 대본은 고르지 않는다. */
export function lastHandledScript<T extends StepScript & { id: string }>(scripts: readonly T[], takes: SceneTakes): T | null {
  let best: T | null = null;
  let bestAt = -1;
  for (const s of scripts) {
    if (!practiceStepOf(s, takes[s.id])) continue;
    const at = Math.max(ms(s.last_practiced_at), takeAt(takes[s.id]));
    if (at > bestAt) {
      best = s;
      bestAt = at;
    }
  }
  return best;
}

/** 그 대본으로 받은 코칭 묶음 — 묶음 id 를 알면 그것, 모르면 코칭을 시작한 뒤에 연습한 같은 제목 묶음 중 가장 최근. */
export function coachGroupFor<G extends { root_id: string; last_practiced_at?: string | null }>(
  take: SceneTake | undefined,
  scriptTitle: string,
  groups: readonly G[],
  titleOf: (group: G) => string,
): G | null {
  if (!take?.coachedAt) return null;
  if (take.coachRootId) return groups.find((g) => g.root_id === take.coachRootId) ?? null;
  const title = scriptTitle.trim();
  const after = take.coachedAt - 60_000;
  return (
    groups
      .filter((g) => titleOf(g).trim() === title && ms(g.last_practiced_at) >= after)
      .sort((a, b) => ms(b.last_practiced_at) - ms(a.last_practiced_at))[0] ?? null
  );
}
