import { apiFetch } from "./client";

// POST /v2/guest/transfer-code 의 응답. api 갈래가 아직 이 엔드포인트를 내지 않아 생성 타입
// (v2-schema.d.ts)에 없다 — 통합 작업(I1)이 생성 타입으로 바꾼다.
export type TransferCodeResponse = {
  /** 숫자 여섯 자리. 서버는 해시만 저장하므로 이 응답에서만 보인다. */
  code: string;
  /** 유효 시간(초). 600. */
  expires_in: number;
  expires_at: string;
};

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
