import { toApiError } from "../api/v2/errors";
import type { GuestResponse } from "../api/v2/types";
import { postAuth } from "./auth-request";
import { emitSessionEvent } from "./session-events";
import {
  clearTokens,
  getAccessToken,
  hasGuestSession,
  setTokens,
} from "./token-store";

let guestInFlight: Promise<string> | null = null;

/**
 * 이 게스트에는 다시 닿을 수 없다 — 서버가 갱신을 거절했거나 계정이 이미 닫혔다. 토큰을
 * 지우고 알리기만 한다. 웹에는 돌려보낼 로그인 화면이 없고, 새 게스트는 다음에 보호
 * 기능을 쓰려 할 때 공용 클라이언트가 만든다.
 *
 * 앱으로 옮겨져 끝났다면(`transferred`) 그것도 알린다. 화면은 "옮겼어요" 안내를 띄운다.
 */
export function endGuestSession(reason?: "transferred"): null {
  clearTokens();
  emitSessionEvent("guest-ended");
  if (reason === "transferred") emitSessionEvent("guest-transferred");
  return null;
}

async function createGuestInsideLock(): Promise<string> {
  // 락을 기다리는 사이 다른 탭이 먼저 게스트를 만들었으면 그 게스트를 같이 쓴다.
  const currentAccess = getAccessToken();
  if (hasGuestSession() && currentAccess) return currentAccess;

  const { response, payload } = await postAuth("/v2/auth/guest", "게스트 시작");
  if (!response.ok) {
    throw toApiError(
      response.status,
      payload,
      response.headers.get("X-Request-Id") ?? undefined,
    );
  }

  // POST /v2/auth/guest 는 201 이다. 성공 여부는 위에서 response.ok 로 본다.
  const guest = payload as GuestResponse;
  setTokens(guest, guest.user);
  emitSessionEvent("guest-started");
  return guest.access_token;
}

function createGuestWithCrossTabLock(): Promise<string> {
  if (typeof navigator === "undefined" || !navigator.locks) {
    return createGuestInsideLock();
  }
  const locked = navigator.locks.request<Promise<string>>(
    "acttub.guest",
    () => createGuestInsideLock(),
  );
  return locked.then((result) => result);
}

/**
 * 게스트 계정을 만들고 액세스 토큰을 돌려준다. 공용 클라이언트가 처음 보호 기능을 쓰려
 * 할 때만 부른다 — 랜딩·동의 문서·입시 정보만 볼 때는 서버에 계정이 생기지 않는다
 * (account.guest).
 */
export function ensureGuestSession(): Promise<string> {
  if (guestInFlight) return guestInFlight;

  const pending = createGuestWithCrossTabLock();
  guestInFlight = pending;
  const release = () => {
    if (guestInFlight === pending) guestInFlight = null;
  };
  void pending.then(release, release);
  return pending;
}
