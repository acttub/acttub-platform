import { requestTransferCode } from "@/lib/api/v2/guest-transfer";
import { apiFetch } from "@/lib/api/v2/client";
import { ApiError } from "@/lib/api/v2/errors";
import { hasGuestSession, isMemberSession } from "@/lib/auth/token-store";

// 로그인하면 이 브라우저의 게스트 연습을 회원 계정으로 옮긴다(account.guest 이관과 같은 길).
// 로그인 전에 게스트 토큰으로 이관 코드를 받아 두고, 회원 토큰을 받은 뒤 그 코드를 쓴다.
const CODE_KEY = "acttub.web.carry_code";

/** 로그인을 시작하기 직전에 부른다. 게스트가 없거나 이미 회원이면 아무것도 하지 않는다. */
export async function prepareGuestCarry(): Promise<void> {
  if (!hasGuestSession() || isMemberSession()) return;
  try {
    const { code } = await requestTransferCode();
    sessionStorage.setItem(CODE_KEY, code);
  } catch {
    // 옮길 자료가 없거나 코드를 못 받았다. 로그인은 그대로 한다.
  }
}

export type CarryOutcome = "none" | "moved" | "failed";

/**
 * 회원 토큰을 넣은 뒤 부른다. 양쪽에 기억이 다 있으면(409 memory_choice_required) 회원 쪽 기억을
 * 남긴다 — 앱의 기본 선택과 같다.
 */
export async function redeemGuestCarry(): Promise<CarryOutcome> {
  const code = sessionStorage.getItem(CODE_KEY);
  sessionStorage.removeItem(CODE_KEY);
  if (!code) return "none";
  const send = (body: { code: string; memory_choice?: "member" }) =>
    apiFetch<unknown>("/v2/guest-transfers", { method: "POST", body, startGuest: false, consentPrompt: false });
  try {
    await send({ code });
    return "moved";
  } catch (error) {
    if (error instanceof ApiError && error.code === "memory_choice_required") {
      try {
        await send({ code, memory_choice: "member" });
        return "moved";
      } catch {
        return "failed";
      }
    }
    return "failed";
  }
}
