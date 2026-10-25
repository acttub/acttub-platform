import { ACTTUB_CLIENT, API_BASE_URL } from "../../config/env";
import { parsePayload } from "../../auth/auth-request";
import { clearTokens, getRefreshToken, type AuthUser, type TokenPair } from "../../auth/token-store";
import { apiFetch } from "./client";
import { NetworkError, responseError } from "./errors";
import type { ConsentDocument } from "./types";

/**
 * 웹 회원 로그인(account.login, SOMA-834). 앱과 같은 POST /v2/auth/login·signup 을 쓴다.
 * 로그인 전에는 세션이 없으므로 공용 클라이언트(게스트 갱신·동의 시트)를 거치지 않고 직접 부른다.
 */
export type LoginInput =
  | { provider: "google"; id_token: string }
  | { provider: "naver"; authorization_code: string; code_verifier: string; redirect_uri: string; state: string };

export type SignedIn = TokenPair & { result: "signed_in"; user: AuthUser; pending_consents: ConsentDocument[] };
export type SignupRequired = { result: "signup_required"; signup_token: string; expires_in: number; documents: ConsentDocument[] };
export type LoginResult = SignedIn | SignupRequired;

export type SignupDecision = { document_id: string; action: "granted" | "declined" };

export type Me = {
  id: string;
  email: string | null;
  status: "active" | "deactivated";
  account_type: string;
  profile_complete: boolean;
  profile?: { name?: string | null } | null;
};

async function post<T>(path: string, body: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Acttub-Client": ACTTUB_CLIENT, "Accept-Language": "ko" },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new NetworkError("네트워크 요청에 실패했습니다.", { cause: error });
  }
  const payload = await parsePayload(response, "API");
  if (!response.ok) throw responseError(response, payload);
  return payload as T;
}

/** 서버에서 켜 둔 제공자. 웹은 이 중 웹에서 쓸 수 있는 것만 그린다. */
export async function fetchProviders(): Promise<string[]> {
  const response = await fetch(`${API_BASE_URL}/v2/auth/providers`, { headers: { "X-Acttub-Client": ACTTUB_CLIENT } });
  if (!response.ok) return [];
  const data = (await response.json()) as { providers?: unknown };
  return Array.isArray(data.providers) ? data.providers.filter((p): p is string => typeof p === "string") : [];
}

export function login(input: LoginInput): Promise<LoginResult> {
  return post<LoginResult>("/v2/auth/login", input);
}

/** 가입 동의 제출. 통과하는 순간 계정이 생긴다. 만 14세 확인은 화면에서 받은 뒤에만 부른다. */
export function signup(signupToken: string, decisions: SignupDecision[]): Promise<TokenPair> {
  return post<TokenPair>("/v2/auth/signup", { signup_token: signupToken, decisions, age_confirmed: true });
}

export async function fetchMe(): Promise<Me> {
  const { data } = await apiFetch<Me>("/v2/me", { startGuest: false, consentPrompt: false });
  return data;
}

/** 로그아웃: 서버에서 이 리프레시 토큰을 끊고 브라우저 토큰을 지운다. 서버가 실패해도 브라우저는 지운다. */
export async function logout(): Promise<void> {
  const refresh = getRefreshToken();
  try {
    if (refresh) {
      await apiFetch<void>("/v2/auth/logout", {
        method: "POST",
        body: { refresh_token: refresh },
        startGuest: false,
        consentPrompt: false,
      });
    }
  } finally {
    clearTokens();
  }
}

/** 회원 탈퇴(DELETE /v2/me). 다시 불러도 같은 응답이다. 끝나면 브라우저 토큰을 지운다. */
export async function withdraw(): Promise<void> {
  await apiFetch<unknown>("/v2/me", { method: "DELETE", startGuest: false, consentPrompt: false });
  clearTokens();
}
