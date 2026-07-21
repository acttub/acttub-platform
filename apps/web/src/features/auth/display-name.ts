"use client";

// 배우가 직접 정한 호칭. 없으면 이메일 앞글자를 쓰던 자리를 대체한다.
//
// 계정 id별로 따로 저장한다. 한 브라우저를 여러 사람이 쓰거나 세션이 만료돼
// 다른 계정으로 다시 로그인하는 일이 있는데,
//   - 하나만 저장하면 앞사람 이름으로 인사하게 되고,
//   - 하나만 저장하면서 주인을 검사하면 뒷사람이 앞사람 이름을 덮어써서
//     앞사람이 돌아왔을 때 "한 번만 묻는다"던 팝업을 또 보게 된다.
// 그래서 id를 키로 한 표로 들고 있는다.
//
// TODO(백엔드): 지금은 이 브라우저에만 남는다. `/v2/me`가 생기면
// 서버에 저장하고 여기는 캐시로만 쓴다. 기기를 바꾸면 다시 물어보게 된다.

import { getStoredUser } from "@/lib/auth/token-store";

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

export function saveDisplayName(value: string): string | null {
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
