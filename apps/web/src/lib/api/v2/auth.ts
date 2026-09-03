import {
  clearTokens,
  getRefreshToken,
  setTokens,
} from "../../auth/token-store";
import { emitSessionEvent } from "../../auth/session-events";
import { apiFetch } from "./client";
import type { LoginRequest, LogoutRequest, TokenPairResponse } from "./types";

export async function login(
  provider: LoginRequest["provider"],
  idToken: string,
): Promise<TokenPairResponse> {
  const { data } = await apiFetch<TokenPairResponse>("/v2/auth/login", {
    method: "POST",
    body: { provider, id_token: idToken } satisfies LoginRequest,
    auth: false,
    retryOn401: false,
  });
  setTokens(data, data.user);
  emitSessionEvent("login");
  return data;
}

export async function logout(): Promise<void> {
  const refreshToken = getRefreshToken();
  try {
    if (refreshToken) {
      await apiFetch<void>("/v2/auth/logout", {
        method: "POST",
        body: { refresh_token: refreshToken } satisfies LogoutRequest,
        auth: true,
        retryOn401: false,
      });
    }
  } catch {
    // 서버 폐기에 실패해도 로컬 세션 종료는 항상 완료한다.
  } finally {
    clearTokens();
    emitSessionEvent("logout");
  }
}
