/**
 * 홈이 마지막으로 받은 기록(연습 묶음·대본·센 연습·연습한 날·참여한 챌린지) — 앱을 켤 때 서버 답을 기다리지 않고 홈을 그린다.
 *
 * 전에는 홈 기록 다섯 갈래(대본 → 대본별 회차까지)를 다 받을 때까지 로고를 최대 3초 붙잡아 앱이 켜지는 데 4~6초 걸렸다
 * (11/3 폰 QA). 이제 계정별로 기기에 남긴 지난번 홈을 먼저 그리고, 새로 받은 답으로 칸만 바꾼다.
 * 계정 id 가 다르면 쓰지 않는다. 7일 지난 것도 쓰지 않는다(오래된 화면을 오래 보이지 않게).
 *
 * ⚠️ 네이티브 모듈이 없는 환경(Node 테스트)에서도 불러올 수 있게 저장소는 함수 안 require 로만 닿는다.
 */
import { deviceStorage, type DeviceStorage } from './device-storage.ts';

type Storage = Pick<DeviceStorage, 'getItem' | 'setItem'> & Partial<Pick<DeviceStorage, 'removeItem'>>;

export const HOME_SNAPSHOT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const keyFor = (owner: string) => `acttub.homeSnapshot.${owner}`;

export type HomeSnapshot<G, S, P> = {
  owner: string;
  savedAt: number;
  groups: G[];
  scripts: S[];
  practices: P[];
  activityDays: { created_at: string }[];
  enteredChallengeIds: string[];
};

function storage(): DeviceStorage | null {
  try {
    return deviceStorage() ?? null;
  } catch {
    return null;
  }
}

/** 쓸 수 있는 스냅샷인가 — 같은 계정, 7일 안, 모양이 맞을 때만. */
export function usableSnapshot<G, S, P>(raw: unknown, owner: string, now: number): HomeSnapshot<G, S, P> | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Partial<HomeSnapshot<G, S, P>>;
  if (s.owner !== owner || typeof s.savedAt !== 'number' || now - s.savedAt > HOME_SNAPSHOT_MAX_AGE_MS || now < s.savedAt - 60_000) return null;
  if (!Array.isArray(s.groups) || !Array.isArray(s.scripts) || !Array.isArray(s.practices) || !Array.isArray(s.activityDays) || !Array.isArray(s.enteredChallengeIds)) return null;
  return s as HomeSnapshot<G, S, P>;
}

export async function readHomeSnapshot<G, S, P>(owner: string, store: Storage | null = storage(), now = Date.now()): Promise<HomeSnapshot<G, S, P> | null> {
  if (!store) return null;
  try {
    const text = await store.getItem(keyFor(owner));
    return text ? usableSnapshot<G, S, P>(JSON.parse(text), owner, now) : null;
  } catch {
    return null;
  }
}

export async function writeHomeSnapshot<G, S, P>(snapshot: Omit<HomeSnapshot<G, S, P>, 'savedAt'>, store: Storage | null = storage(), now = Date.now()): Promise<void> {
  if (!store || !snapshot.owner) return;
  try {
    await store.setItem(keyFor(snapshot.owner), JSON.stringify({ ...snapshot, savedAt: now }));
  } catch {
    // 못 남겨도 다음엔 예전처럼 받을 때까지 기다릴 뿐이다.
  }
}
