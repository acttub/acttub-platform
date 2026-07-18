import { API_BASE_URL, LOGIN_PATH } from "../config/env";
import { NetworkError, toApiError } from "../api/v2/errors";
import type { RefreshTokenResponse } from "../api/v2/types";
import {
  clearTokens,
  getAccessToken,
  getRefreshToken,
  setTokens,
} from "./token-store";
import { emitSessionEvent } from "./session-events";

let refreshInFlight: Promise<string | null> | null = null;

function redirectToLogin(): void {
  if (typeof window === "undefined") return;
  const next = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  window.location.replace(`${LOGIN_PATH}?next=${encodeURIComponent(next)}`);
}

function invalidateSession(): null {
  clearTokens();
  emitSessionEvent("logout");
  redirectToLogin();
  return null;
}

async function parsePayload(response: Response): Promise<unknown> {
  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    if (error instanceof TypeError) {
      throw new NetworkError("토큰 갱신 응답을 읽는 중 네트워크 연결이 끊어졌습니다.", {
        cause: error,
      });
    }
    throw error;
  }
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

async function refreshInsideLock(failedAccess?: string): Promise<string | null> {
  const currentAccess = getAccessToken();
  if (failedAccess !== undefined && currentAccess !== failedAccess) {
    return currentAccess;
  }

  // 회전 토큰은 락을 획득한 뒤 최대한 늦게 읽어야 다른 탭의 승자를 재사용할 수 있다.
  const sentRefresh = getRefreshToken();
  if (!sentRefresh) return invalidateSession();

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/v2/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: sentRefresh }),
    });
  } catch (error) {
    if (error instanceof TypeError) {
      throw new NetworkError("토큰 갱신 요청에 실패했습니다.", { cause: error });
    }
    throw error;
  }

  const payload = await parsePayload(response);
  if (response.status === 401 || response.status === 422) {
    const latestRefresh = getRefreshToken();
    if (latestRefresh !== sentRefresh) {
      // 다른 탭이 먼저 회전에 성공했다. 저장된 새 access를 채택하고 로그아웃하지 않는다.
      return getAccessToken();
    }
    return invalidateSession();
  }

  if (!response.ok) {
    throw toApiError(
      response.status,
      payload,
      response.headers.get("X-Request-Id") ?? undefined,
    );
  }

  // 요청 도중 logout·새 login·다른 회전이 끝났다면 늦은 응답으로 최신 세션을 덮지 않는다.
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
