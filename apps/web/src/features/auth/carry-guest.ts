import { apiFetch } from "@/lib/api/v2/client";
import { ApiError } from "@/lib/api/v2/errors";
import { postAuth } from "@/lib/auth/auth-request";
import { ACTTUB_CLIENT, API_BASE_URL } from "@/lib/config/env";
import {
  getAccessToken,
  getRefreshToken,
  hasGuestSession,
  isMemberSession,
  type TokenPair,
} from "@/lib/auth/token-store";

// 로그인하면 이 브라우저의 게스트 연습을 회원 계정으로 옮긴다(account.guest 이관과 같은 길).
//
// 회원 토큰이 게스트 토큰 자리를 덮기 전에 게스트 토큰을 따로 둔다(BACKUP_KEY). 옮기기가
// 실제로 끝났을 때만 지운다 — 실패해도 그 게스트에 다시 닿아 나중에 다시 옮길 수 있다.
const BACKUP_KEY = "acttub.web.guest_backup";
const STATUS_KEY = "acttub.web.carry_status";

export type CarryOutcome = "none" | "moved" | "failed";

const store = (): Storage | null => (typeof window === "undefined" ? null : window.localStorage);

function readBackup(): TokenPair | null {
  const raw = store()?.getItem(BACKUP_KEY);
  if (!raw) return null;
  try {
    const pair = JSON.parse(raw) as TokenPair;
    return pair.access_token && pair.refresh_token ? pair : null;
  } catch {
    return null;
  }
}

/** 회원 토큰을 넣기 직전에 부른다. 게스트가 있고 아직 회원이 아니면 게스트 토큰을 따로 둔다. */
export function backupGuestBeforeLogin(): void {
  if (!hasGuestSession() || isMemberSession()) return;
  const access = getAccessToken();
  const refresh = getRefreshToken();
  if (!access || !refresh) return;
  store()?.setItem(BACKUP_KEY, JSON.stringify({ access_token: access, refresh_token: refresh }));
}

/** 옮기지 못한 게스트 연습이 남아 있는지. 내 계정 화면이 다시 옮기기를 보여 준다. */
export function hasPendingCarry(): boolean {
  return readBackup() !== null;
}

/** 로그인 직후의 결과를 한 번만 읽는다. */
export function takeCarryStatus(): CarryOutcome | null {
  const value = store()?.getItem(STATUS_KEY) ?? null;
  store()?.removeItem(STATUS_KEY);
  return value === "moved" || value === "failed" ? value : null;
}

async function guestTransferCode(backup: TokenPair): Promise<string | null> {
  const ask = (access: string) =>
    fetch(`${API_BASE_URL}/v2/guest/transfer-code`, {
      method: "POST",
      headers: { "X-Acttub-Client": ACTTUB_CLIENT, Authorization: `Bearer ${access}` },
    });
  let response = await ask(backup.access_token);
  if (response.status === 401) {
    const renewed = await postAuth("/v2/auth/refresh", "토큰 갱신", { refresh_token: backup.refresh_token });
    if (!renewed.response.ok) {
      // 게스트가 이미 끝났다(옮겨졌거나 닫혔다). 다시 닿을 수 없으니 보관본도 지운다.
      if (renewed.response.status === 401 || renewed.response.status === 422) store()?.removeItem(BACKUP_KEY);
      return null;
    }
    const pair = renewed.payload as TokenPair;
    store()?.setItem(BACKUP_KEY, JSON.stringify({ access_token: pair.access_token, refresh_token: pair.refresh_token }));
    response = await ask(pair.access_token);
  }
  if (response.status === 403) {
    // guest_transferred 등 — 이 게스트에서는 더 옮길 것이 없다.
    store()?.removeItem(BACKUP_KEY);
    return null;
  }
  if (!response.ok) throw new ApiError(response.status, "transfer_code_failed", null);
  const payload = (await response.json()) as { code?: string };
  return payload.code ?? null;
}

/**
 * 회원 토큰을 넣은 뒤 부른다. 양쪽에 기억이 다 있으면(409 memory_choice_required) 회원 쪽 기억을
 * 남긴다 — 앱의 기본 선택과 같다. 실패하면(동의·프로필이 덜 찬 회원, 네트워크 등) 보관본을 남겨 두고
 * "failed" 를 돌려준다.
 */
export async function redeemGuestCarry(): Promise<CarryOutcome> {
  const backup = readBackup();
  if (!backup || !isMemberSession()) return "none";
  let result: CarryOutcome;
  try {
    const code = await guestTransferCode(backup);
    if (!code) {
      result = readBackup() ? "failed" : "none";
    } else {
      const send = (body: { code: string; memory_choice?: "member" }) =>
        apiFetch<unknown>("/v2/guest-transfers", { method: "POST", body, startGuest: false, consentPrompt: false });
      try {
        await send({ code });
      } catch (error) {
        if (!(error instanceof ApiError && error.code === "memory_choice_required")) throw error;
        await send({ code, memory_choice: "member" });
      }
      store()?.removeItem(BACKUP_KEY);
      result = "moved";
    }
  } catch {
    result = "failed";
  }
  if (result !== "none") store()?.setItem(STATUS_KEY, result);
  return result;
}
