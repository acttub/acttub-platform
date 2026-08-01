"use client";

// 배우가 직접 정한 호칭. 없으면 이메일 앞글자를 쓰던 자리를 대체한다.
//
// 정본은 서버(`/v2/me`의 nickname)다. 커뮤니티에서 남에게 보이는 이름이라
// 기기 안에만 둘 수 없다. 여기 localStorage는 첫 화면이 깜빡이지 않게 하는 캐시다.
//
// 캐시는 계정 id별로 따로 저장한다. 한 브라우저를 여러 사람이 쓰거나 세션이 만료돼
// 다른 계정으로 다시 로그인하는 일이 있는데,
//   - 하나만 저장하면 앞사람 이름으로 인사하게 되고,
//   - 하나만 저장하면서 주인을 검사하면 뒷사람이 앞사람 이름을 덮어써서
//     앞사람이 돌아왔을 때 "한 번만 묻는다"던 팝업을 또 보게 된다.
// 그래서 id를 키로 한 표로 들고 있는다.

import { getStoredUser } from "@/lib/auth/token-store";
import { getMe, updateNickname } from "@/lib/api/v2/me";

const DISPLAY_NAME_KEY = "acttub.display_names";

export const DISPLAY_NAME_MAX_LENGTH = 20;

export function normalizeDisplayName(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(0, DISPLAY_NAME_MAX_LENGTH);
}

function currentUserId(): string | null {
  return getStoredUser()?.id ?? null;
}

function readAll(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(DISPLAY_NAME_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const entries = Object.entries(parsed as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    );
    return Object.fromEntries(entries);
  } catch {
    // 읽을 수 없는 값이면 없는 것으로 본다 (주인을 모르는 이름을 쓰지 않는다)
    return {};
  }
}

export function getStoredDisplayName(): string | null {
  const userId = currentUserId();
  if (!userId) return null;
  const stored = readAll()[userId];
  if (!stored) return null;
  return normalizeDisplayName(stored) || null;
}

function cacheDisplayName(value: string): string | null {
  const name = normalizeDisplayName(value);
  if (typeof window === "undefined") return name || null;
  const userId = currentUserId();
  // 누구 것인지 모르면 저장하지 않는다 (다음 로그인에 새어나가지 않게)
  if (!userId) return name || null;

  try {
    const all = readAll();
    if (name) all[userId] = name;
    else delete all[userId];
    window.localStorage.setItem(DISPLAY_NAME_KEY, JSON.stringify(all));
  } catch {
    /* 저장이 막힌 환경에서도 이번 세션은 그대로 진행한다 */
  }
  return name || null;
}

/**
 * 이름을 서버에 저장하고 캐시도 갱신한다.
 *
 * 서버 저장이 실패해도 이번 세션은 캐시로 굴러가게 둔다 — 이름은 부가정보이고,
 * 여기서 막으면 연습을 시작하지 못한다.
 */
export async function saveDisplayName(value: string): Promise<string | null> {
  const name = cacheDisplayName(value);
  if (!name) return null;
  try {
    await updateNickname(name);
  } catch {
    /* 다음 진입 때 다시 올라간다 */
  }
  return name;
}

/**
 * 서버에 있는 이름을 가져온다. 정본이 서버이므로 여기 결과가 캐시를 이긴다.
 *
 * 서버에 이름이 없고 이 브라우저에만 있으면 그 값을 올려 준다 — 서버 저장이
 * 생기기 전에 이름을 정한 사람들이 다시 묻는 팝업을 보지 않게 하는 일회성 이관이다.
 */
export async function loadDisplayName(): Promise<string | null> {
  const cached = getStoredDisplayName();
  try {
    const me = await getMe();
    const remote = me.nickname ? normalizeDisplayName(me.nickname) : "";
    if (remote) {
      cacheDisplayName(remote);
      return remote;
    }
    if (cached) {
      await updateNickname(cached);
      return cached;
    }
    return null;
  } catch {
    // 서버에 못 닿으면 캐시로 판단한다. 못 물어보는 것보다 낫다.
    return cached;
  }
}
