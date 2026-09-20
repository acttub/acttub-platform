import type { TransferCodeResponse } from "@/lib/api/v2/guest-transfer";

// 이관 코드 화면이 그리는 것의 순수한 부분. 코드는 브라우저 메모리에만 둔다 — 서버도 해시만
// 들고 있어 다시 받아 올 수 없고, 새로 고치면 새 코드를 받는다(그때 이전 코드는 무효다).

export type IssuedTransferCode = {
  code: string;
  /** 브라우저 시계로 잰 만료 시각(ms). */
  expiresAtMs: number;
};

/**
 * 받은 순간부터 `expires_in` 만큼 유효하다고 본다. 서버의 `expires_at` 을 브라우저 시계와
 * 견주지 않는다 — 폰·PC 의 시계가 몇 분씩 어긋난 경우가 흔하고, 그러면 방금 받은 코드가
 * 만료로 보이거나 죽은 코드가 살아 보인다.
 */
export function issueTransferCode(
  response: TransferCodeResponse,
  receivedAtMs: number,
): IssuedTransferCode {
  return {
    code: response.code,
    expiresAtMs: receivedAtMs + response.expires_in * 1000,
  };
}

/** 남은 시간(초). 올림이라 0 이 되는 순간이 곧 만료다. */
export function remainingSeconds(issued: IssuedTransferCode, nowMs: number): number {
  return Math.max(0, Math.ceil((issued.expiresAtMs - nowMs) / 1000));
}

export type TransferCodeStatus = "none" | "active" | "expired";

export function transferCodeStatus(
  issued: IssuedTransferCode | null,
  nowMs: number,
): TransferCodeStatus {
  if (!issued) return "none";
  return remainingSeconds(issued, nowMs) > 0 ? "active" : "expired";
}

export function formatRemaining(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

/** 여섯 자리를 세 자리씩 끊는다. 폰에 옮겨 적을 때 한눈에 읽힌다. */
export function groupCode(code: string): string {
  return code.replace(/^(\d{3})(\d{3})$/, "$1 $2");
}
