import { apiFetch } from "./client";
import type { TransferCodeResponse } from "./types";

// POST /v2/guest/transfer-code 의 응답(201). code 는 숫자 여섯 자리이고 서버는 해시만
// 저장하므로 이 응답에서만 보인다. expires_in 은 유효 시간(초, 600).
export type { TransferCodeResponse };

/**
 * 앱에 넣을 이관 코드를 받는다. 새로 받으면 이전 코드는 무효다(account.guest).
 *
 * 옮길 자료가 있는 게스트만 부른다 — 게스트가 없으면 서버에 가지 않고, 코드를 받으려고
 * 게스트를 만들지도 않는다.
 */
export async function requestTransferCode(
  options: { signal?: AbortSignal } = {},
): Promise<TransferCodeResponse> {
  const { data } = await apiFetch<TransferCodeResponse>(
    "/v2/guest/transfer-code",
    { method: "POST", signal: options.signal, startGuest: false },
  );
  return data;
}
