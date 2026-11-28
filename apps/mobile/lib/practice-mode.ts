/**
 * 연습 탭의 「리딩 | 코칭」 중 마지막에 고른 쪽. 기기에 하나만 두고, 처음이면 리딩이다.
 * 다른 화면·알림이 한쪽을 지정해 열 때는 주소의 mode(practiceHref)로 보내고, 그것도 고른 것으로 남긴다.
 *
 * 못 읽거나 못 쓰면 리딩으로 열 뿐 막지 않는다.
 * ⚠️ 네이티브 모듈이 없는 환경(Node 테스트)에서도 불러올 수 있게 저장소는 함수 안 require 로만 닿는다.
 */
import { deviceStorage, type DeviceStorage } from './device-storage.ts';

export type PracticeMode = 'reading' | 'coaching';

export const DEFAULT_PRACTICE_MODE: PracticeMode = 'reading';
export const PRACTICE_MODE_KEY = 'acttub.practiceMode';

type Storage = Pick<DeviceStorage, 'getItem' | 'setItem'>;

function storage(): Storage | null {
  try {
    return deviceStorage() ?? null;
  } catch {
    return null;
  }
}

export function isPracticeMode(value: unknown): value is PracticeMode {
  return value === 'reading' || value === 'coaching';
}

/** 연습 탭의 한쪽을 여는 주소. */
export function practiceHref(mode: PracticeMode): `/practice?mode=${PracticeMode}` {
  return `/practice?mode=${mode}`;
}

/** 이번 실행에서 마지막으로 고른 쪽. 읽기 전이면 null. */
let current: PracticeMode | null = null;

/** 기기에서 읽지 않고 바로 아는 값 — 이번 실행에서 이미 골랐으면 그쪽, 아니면 null. */
export function knownPracticeMode(): PracticeMode | null {
  return current;
}

export async function rememberPracticeMode(mode: PracticeMode, store: Storage | null = storage()): Promise<void> {
  if (current === mode) return;
  current = mode;
  try {
    await store?.setItem(PRACTICE_MODE_KEY, mode);
  } catch {
    // 못 써도 다음에 리딩으로 열 뿐이다.
  }
}

/** 연습 탭을 주소의 mode 없이 열 때 보일 쪽. */
export async function resolvePracticeMode(store: Storage | null = storage()): Promise<PracticeMode> {
  if (current) return current;
  try {
    const saved = await store?.getItem(PRACTICE_MODE_KEY);
    if (isPracticeMode(saved)) {
      current = saved;
      return saved;
    }
  } catch {
    // 못 읽으면 처음처럼 연다.
  }
  return DEFAULT_PRACTICE_MODE;
}

/** 테스트 전용 — 이번 실행의 기억을 지운다. */
export function resetPracticeModeForTest(): void {
  current = null;
}
