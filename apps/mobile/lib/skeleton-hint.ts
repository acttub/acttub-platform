/**
 * 뼈대 화면이 어느 모양을 그릴지 정하는 기억(로딩 중 화면이 실제 화면과 다르게 보이던 문제).
 *
 * 홈·리딩·코칭은 서버 답을 받기 전에는 첫 사용자 화면인지, 기존 사용자 화면인지 모른다.
 * 그래서 지난번에 실제로 그린 모양을 기기에 적어 두고, 다음에 화면을 열 때 그 모양의 뼈대를 먼저 보인다.
 * 적어 둔 것이 없으면(새로 깔았거나 로그아웃한 뒤) 첫 사용자 모양으로 본다.
 *
 * 로그아웃 때 지운다(local-account-wipe ACCOUNT_CACHE_KEYS). 탈퇴는 `acttub.` 접두사로 함께 지워진다.
 */
import { useSyncExternalStore } from 'react';

export const SKELETON_HINT_KEY = 'acttub.skeletonHints';

export type SkeletonHints = {
  /** 홈: 첫 사용자 「뭐부터 해 볼까요?」 / 기존 사용자 홈. */
  home?: 'first' | 'returning';
  /** 기존 사용자 홈 오늘 카드의 실제 높이(dp). 카드 종류마다 줄 수가 달라 지난번 높이를 따른다. */
  homeCardHeight?: number;
  /** 기존 사용자 홈 맨 위 광고 칸이 지난번에 보였는가. 뼈대와 받기 전 자리를 같게 해, 광고 칸이 늦게 생기며 카드를 밀지 않게 한다(11/3 폰 QA). */
  homeAd?: boolean;
  /** 리딩 탭: 대본 없음(입구 카드) / 대본 목록. */
  reading?: 'empty' | 'list';
  /** 리딩 탭 대본 목록 줄 수(뼈대 줄 수를 맞춘다, 최대 6). */
  readingRows?: number;
  /** 코칭 탭: 처음 / 다음 연습(코치 메모가 있는 사람). */
  coaching?: 'first' | 'next';
  /** 코칭 탭 최근 코칭 줄 수(최대 2). */
  coachingRows?: number;
};

type Storage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

/** 저장소를 못 쓰면(모듈이 없거나 테스트 환경) null — 뼈대 기억은 없어도 화면은 그대로 뜬다. */
function storage(): Storage | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@react-native-async-storage/async-storage') as { default?: Storage } | undefined;
    const store = (mod?.default ?? mod) as Storage | undefined;
    return store && typeof store.getItem === 'function' && typeof store.setItem === 'function' ? store : null;
  } catch {
    return null;
  }
}

let hints: SkeletonHints = {};
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

function parse(raw: string | null): SkeletonHints {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as unknown;
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
    const v = value as Record<string, unknown>;
    const out: SkeletonHints = {};
    if (v.home === 'first' || v.home === 'returning') out.home = v.home;
    if (typeof v.homeCardHeight === 'number' && Number.isFinite(v.homeCardHeight)) out.homeCardHeight = Math.max(80, Math.min(320, Math.round(v.homeCardHeight)));
    if (typeof v.homeAd === 'boolean') out.homeAd = v.homeAd;
    if (v.reading === 'empty' || v.reading === 'list') out.reading = v.reading;
    if (typeof v.readingRows === 'number' && Number.isFinite(v.readingRows)) out.readingRows = Math.max(1, Math.min(6, Math.round(v.readingRows)));
    if (v.coaching === 'first' || v.coaching === 'next') out.coaching = v.coaching;
    if (typeof v.coachingRows === 'number' && Number.isFinite(v.coachingRows)) out.coachingRows = Math.max(0, Math.min(2, Math.round(v.coachingRows)));
    return out;
  } catch {
    return {};
  }
}

/** 앱을 켤 때 한 번 읽는다(로고가 덮고 있는 동안). 여러 번 불러도 한 번만 읽는다. */
export function loadSkeletonHints(store: Storage | null = storage()): Promise<void> {
  if (!loading) {
    if (!store) return Promise.resolve();
    loading = Promise.resolve()
      .then(() => store.getItem(SKELETON_HINT_KEY))
      .then((raw) => {
        // 읽는 사이에 화면이 먼저 적었으면 그 값을 남긴다.
        hints = { ...parse(raw), ...hints };
        emit();
      })
      .catch(() => undefined);
  }
  return loading;
}

export function getSkeletonHints(): SkeletonHints {
  return hints;
}

/** 실제로 그린 모양을 적는다. 바뀐 것이 없으면 쓰지 않는다. */
export function rememberSkeletonHints(next: SkeletonHints, store?: Storage): void {
  const merged = { ...hints, ...next };
  const changed = (Object.keys(next) as (keyof SkeletonHints)[]).some((key) => hints[key] !== merged[key]);
  if (!changed) return;
  hints = merged;
  emit();
  const target = store ?? storage();
  if (!target) return;
  void Promise.resolve()
    .then(() => target.setItem(SKELETON_HINT_KEY, JSON.stringify(merged)))
    .catch(() => undefined);
}

/** 로그아웃 때 메모리의 기억도 비운다(저장소 키는 local-account-wipe 가 지운다). */
export function resetSkeletonHints(): void {
  hints = {};
  loading = null;
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useSkeletonHints(): SkeletonHints {
  return useSyncExternalStore(subscribe, getSkeletonHints, getSkeletonHints);
}
