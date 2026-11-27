/**
 * 마지막에 쓴 하단 탭(SOMA-1120). 홈 탭이 없어져 '/'(탭 index)는 이 탭으로 보내는 길이다 — 앱을 다시 열거나 다른 화면이
 * 「홈으로」(dismissTo('/(tabs)'))를 부르면 마지막에 쓰던 탭이 열린다. 처음이면 리딩이다.
 *
 * 계정과 상관없이 기기에 하나만 둔다 — 「이 폰에서 마지막에 본 탭」이라 계정을 바꿔도 같은 자리에서 연다.
 * 못 읽거나 못 쓰면 기본값(리딩)으로 열 뿐 막지 않는다.
 *
 * ⚠️ 네이티브 모듈이 없는 환경(Node 테스트)에서도 불러올 수 있게 저장소는 함수 안 require 로만 닿는다.
 */
import { deviceStorage, type DeviceStorage } from './device-storage.ts';

export type TabName = 'reading' | 'coaching' | 'community' | 'challenges' | 'profile';

/** 하단 바 순서(리딩 / 코칭 / 커뮤니티 / 챌린지 / 프로필). */
export const TAB_ORDER: readonly TabName[] = ['reading', 'coaching', 'community', 'challenges', 'profile'];
export const DEFAULT_TAB: TabName = 'reading';
export const LAST_TAB_KEY = 'acttub.lastTab';

type Storage = Pick<DeviceStorage, 'getItem' | 'setItem'>;

function storage(): Storage | null {
  try {
    return deviceStorage() ?? null;
  } catch {
    return null;
  }
}

export function isTabName(value: unknown): value is TabName {
  return typeof value === 'string' && (TAB_ORDER as readonly string[]).includes(value);
}

/** 이번 실행에서 마지막으로 본 탭. 읽기 전·처음이면 null. */
let current: TabName | null = null;

/** 「홈으로」 갈 탭 — 이번 실행에서 본 탭, 없으면 리딩. */
export function homeTab(): TabName {
  return current ?? DEFAULT_TAB;
}

/** 탭이 보일 때마다 부른다. 같은 탭이면 다시 쓰지 않는다. */
export async function rememberLastTab(tab: TabName, store: Storage | null = storage()): Promise<void> {
  if (current === tab) return;
  current = tab;
  try {
    await store?.setItem(LAST_TAB_KEY, tab);
  } catch {
    // 못 써도 다음에 리딩으로 열 뿐이다.
  }
}

/**
 * 앱을 열 때 열 탭과, 기기에 남긴 탭을 되살렸는지(app_open_tab 의 restored). 이번 실행에서 이미 탭을 봤으면 그 탭이다.
 */
export async function resolveLaunchTab(store: Storage | null = storage()): Promise<{ tab: TabName; restored: boolean }> {
  if (current) return { tab: current, restored: true };
  try {
    const saved = await store?.getItem(LAST_TAB_KEY);
    if (isTabName(saved)) return { tab: saved, restored: true };
  } catch {
    // 못 읽으면 처음처럼 연다.
  }
  return { tab: DEFAULT_TAB, restored: false };
}

/** 이번 실행에서 앱을 연 탭을 이미 기록했나(app_open_tab 은 앱을 열 때 한 번만). */
let launchLogged = false;

/** 처음 부를 때만 true — 그 뒤 「홈으로」 넘기기는 앱 열기로 세지 않는다. */
export function takeLaunchVisit(): boolean {
  if (launchLogged) return false;
  launchLogged = true;
  return true;
}

/** 테스트 전용 — 이번 실행의 기억을 지운다. */
export function resetLastTabForTest(): void {
  current = null;
  launchLogged = false;
}
