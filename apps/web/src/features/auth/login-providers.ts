// 웹에서 쓸 수 있는 로그인 제공자(SOMA-834). 서버가 켜 둔 제공자 중 웹 설정이 있는 것만 그린다.
// 카카오·애플은 웹 흐름(카카오 JS SDK, 애플 Services ID)이 아직 없어 웹에는 없다.

/** 구글 웹 OAuth 클라이언트. 서버(GOOGLE_OAUTH_CLIENT_ID)가 이 값을 audience 로 검증한다. */
export const GOOGLE_WEB_CLIENT_ID =
  process.env.NEXT_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? "462651930952-625pcnhrjib79r7990fqsdqhsterdij2.apps.googleusercontent.com";

/** 네이버 Client ID. 비어 있으면 네이버 버튼을 그리지 않는다. */
export const NAVER_WEB_CLIENT_ID = process.env.NEXT_PUBLIC_NAVER_CLIENT_ID ?? "";

/** 웹 네이버 로그인이 돌아오는 자리. 앱용 /auth/naver/callback 과 다르다(그쪽은 앱 스킴으로 넘긴다). */
export const NAVER_WEB_CALLBACK_PATH = "/auth/naver/web";
export const NAVER_AUTHORIZE_URL = "https://nid.naver.com/oauth2/authorize";

export type WebProvider = "google" | "naver";

/** 서버 순서를 따르되(앱 로그인 화면과 같은 순서) 웹에서 쓸 수 있는 것만 남긴다. */
export function webProviders(server: string[], env = { google: GOOGLE_WEB_CLIENT_ID, naver: NAVER_WEB_CLIENT_ID }): WebProvider[] {
  return server.filter((p): p is WebProvider => (p === "google" && Boolean(env.google)) || (p === "naver" && Boolean(env.naver)));
}

const PENDING_KEY = "acttub.web.naver_pending";
const NEXT_KEY = "acttub.web.login_next";

function base64Url(bytes: Uint8Array): string {
  let text = "";
  for (const b of bytes) text += String.fromCharCode(b);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** 네이버 인가 주소. verifier·state 는 돌아올 때까지 이 탭의 sessionStorage 에만 둔다. */
export async function naverAuthorizeUrl(origin: string): Promise<string> {
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const state = base64Url(crypto.getRandomValues(new Uint8Array(16)));
  const challenge = base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  const redirectUri = `${origin}${NAVER_WEB_CALLBACK_PATH}`;
  sessionStorage.setItem(PENDING_KEY, JSON.stringify({ verifier, state, redirectUri }));
  const query = new URLSearchParams({
    response_type: "code",
    client_id: NAVER_WEB_CLIENT_ID,
    redirect_uri: redirectUri,
    state,
    scope: "openid",
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return `${NAVER_AUTHORIZE_URL}?${query.toString()}`;
}

export function takeNaverPending(): { verifier: string; state: string; redirectUri: string } | null {
  const raw = sessionStorage.getItem(PENDING_KEY);
  sessionStorage.removeItem(PENDING_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** 로그인 뒤 돌아갈 곳. 같은 사이트 경로만 받는다. */
export function safeNext(value: string | null | undefined): string {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/account";
}

export function rememberNext(next: string): void {
  sessionStorage.setItem(NEXT_KEY, safeNext(next));
}

export function takeNext(): string {
  const value = sessionStorage.getItem(NEXT_KEY);
  sessionStorage.removeItem(NEXT_KEY);
  return safeNext(value);
}
