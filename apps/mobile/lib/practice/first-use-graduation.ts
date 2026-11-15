import { setFirstTimeState } from './first-time.ts';
import { deviceStorage as storage } from '../device-storage.ts';

/**
 * 첫 사용자 졸업 표시(SOMA-827) — 리딩을 마지막 줄까지 가 봤거나 코칭을 노트·일지까지 가 본 계정.
 *
 * 「연습 1회」(lib/practice/counted)는 리딩에서 인식된 내 대사가 있어야 완료라, 마이크가 못 알아들은 사람은 끝까지 해도
 * 첫 사용자 화면에 남았다. 첫 사용자 화면은 「한 번은 끝까지 해 봤나」만 보면 되므로 이 기기에 계정별로 따로 남긴다.
 * 불꽃·주간 원은 그대로 「연습 1회」를 쓴다. 다른 기기에서는 서버 기록(노트·완료 회차·연습한 날)으로 판단한다.
 *
 * ⚠️ 네이티브 모듈이 없는 환경(Node 테스트)에서 조용히 넘어가도록 함수 안 require 로만 저장소에 닿는다.
 */

const keyFor = (userId: string) => `acttub.firstUse.graduated.${userId}`;

/** 지금 로그인한 계정 — 로그인 상태(lib/auth)가 바뀔 때 알려 준다. 화면이 계정을 몰라도 표시를 남길 수 있게. */
let owner: string | null = null;

/**
 * 이번 실행에서 졸업한 계정 — 저장소 쓰기·읽기를 기다리지 않고 바로 안다. 첫 연습을 끝내고 홈에 오면 저장값을 다시 읽는 동안
 * 첫 사용자 홈이 잠깐 보였다가 바뀌었다(11/2 QA).
 */
const graduatedNow = new Set<string>();

/** 이번 실행에서 졸업 표시를 남긴 계정인지 — 저장소를 기다리지 않는다. */
export function graduatedInMemory(userId: string | null | undefined = owner): boolean {
  return !!userId && graduatedNow.has(userId);
}

let waiters: ((id: string) => void)[] = [];

export function setFirstUseOwner(userId: string | null): void {
  owner = userId;
  if (!userId) return;
  const ready = waiters;
  waiters = [];
  for (const resolve of ready) resolve(userId);
}

/**
 * 계정이 정해지면 그 id, `waitMs` 안에 안 정해지면 null. 앱을 막 켜면 화면이 로그인 정보(me)보다 먼저 그려져
 * 계정별 기록을 계정 없이 읽게 된다 — 그러면 본 안내를 못 본 것으로 읽어 켤 때마다 다시 띄웠다(10/26).
 */
export function firstUseOwnerReady(waitMs: number): Promise<string | null> {
  if (owner || waitMs <= 0) return Promise.resolve(owner);
  return new Promise((resolve) => {
    const done = (id: string | null) => {
      clearTimeout(timer);
      waiters = waiters.filter((w) => w !== done);
      resolve(id);
    };
    const timer = setTimeout(() => done(owner), waitMs);
    waiters.push(done);
  });
}

/** 지금 로그인한 계정 id — 기기에 남기는 계정별 기록(연습한 날·가이드 본 기록)의 키에 붙인다. */
export function currentFirstUseOwner(): string | null {
  return owner;
}

export async function hasGraduatedFirstUse(userId: string | null | undefined = owner): Promise<boolean> {
  if (!userId) return false;
  if (graduatedNow.has(userId)) return true;
  try {
    return (await storage().getItem(keyFor(userId))) === '1';
  } catch {
    // 못 읽으면 서버 기록으로만 판단한다.
    return false;
  }
}

/** 끝까지 해 본 순간 부른다. 탭바와 (뒤에 숨은) 홈이 subscribeFirstTimeState 로 바로 다시 그린다(SOMA-1075). */
export async function markFirstUseGraduated(userId: string | null | undefined = owner): Promise<void> {
  if (!userId) return;
  graduatedNow.add(userId);
  setFirstTimeState('practiced');
  try {
    await storage().setItem(keyFor(userId), '1');
  } catch {
    // 못 적어도 이번 실행에서는 탭바가 보인다. 다음 실행은 서버 기록으로 판단한다.
  }
}
