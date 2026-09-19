import { toApiError } from "../api/v2/errors";
import type { RefreshTokenResponse } from "../api/v2/types";
import { postAuth } from "./auth-request";
import { endGuestSession } from "./guest-session";
import { getAccessToken, getRefreshToken, setTokens } from "./token-store";

let refreshInFlight: Promise<string | null> | null = null;

async function refreshInsideLock(failedAccess?: string): Promise<string | null> {
  const currentAccess = getAccessToken();
  if (failedAccess !== undefined && currentAccess !== failedAccess) {
    return currentAccess;
  }

  // 회전 토큰은 락을 획득한 뒤 최대한 늦게 읽어야 다른 탭의 승자를 재사용할 수 있다.
  const sentRefresh = getRefreshToken();
  if (!sentRefresh) return endGuestSession();

  const { response, payload } = await postAuth("/v2/auth/refresh", "토큰 갱신", {
    refresh_token: sentRefresh,
  });
  if (response.status === 401 || response.status === 422) {
    const latestRefresh = getRefreshToken();
    if (latestRefresh !== sentRefresh) {
      // 다른 탭이 먼저 회전에 성공했다. 저장된 새 access를 채택하고 세션을 끝내지 않는다.
      return getAccessToken();
    }
    return endGuestSession();
  }

  if (!response.ok) {
    throw toApiError(
      response.status,
      payload,
      response.headers.get("X-Request-Id") ?? undefined,
    );
  }

  // 요청 도중 게스트가 끝났거나 다른 회전이 끝났다면 늦은 응답으로 최신 세션을 덮지 않는다.
  if (getRefreshToken() !== sentRefresh) {
    return getAccessToken();
  }

  const tokens = payload as RefreshTokenResponse;
  setTokens(tokens);
  return tokens.access_token;
}

function refreshWithCrossTabLock(failedAccess?: string): Promise<string | null> {
  if (typeof navigator === "undefined" || !navigator.locks) {
    return refreshInsideLock(failedAccess);
  }
  const locked = navigator.locks.request<Promise<string | null>>(
    "acttub.refresh",
    () => refreshInsideLock(failedAccess),
  );
  return locked.then((result) => result);
}

export function refreshAccessToken(failedAccess?: string): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;

  const pending = refreshWithCrossTabLock(failedAccess);
  refreshInFlight = pending;
  void pending.then(
    () => {
      if (refreshInFlight === pending) refreshInFlight = null;
    },
    () => {
      if (refreshInFlight === pending) refreshInFlight = null;
    },
  );
  return pending;
}
