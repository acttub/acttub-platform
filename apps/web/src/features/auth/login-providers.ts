// 웹에서 쓸 수 있는 로그인 제공자(SOMA-834). 서버가 켜 둔 제공자 중 웹 설정이 있는 것만 그린다.
// 카카오·애플은 웹 흐름이 아직 없어 웹에는 없다. 아래 TODO 자리에 붙인다.

/** 구글 웹 OAuth 클라이언트. 서버(GOOGLE_OAUTH_CLIENT_ID)가 이 값을 audience 로 검증한다. */
export const GOOGLE_WEB_CLIENT_ID =
  process.env.NEXT_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? "462651930952-625pcnhrjib79r7990fqsdqhsterdij2.apps.googleusercontent.com";

/** 네이버 Client ID. 비어 있으면 네이버 버튼을 그리지 않는다. */
export const NAVER_WEB_CLIENT_ID = process.env.NEXT_PUBLIC_NAVER_CLIENT_ID ?? "";

/** 웹 네이버 로그인이 돌아오는 자리. 앱용 /auth/naver/callback 과 다르다(그쪽은 앱 스킴으로 넘긴다). */
export const NAVER_WEB_CALLBACK_PATH = "/auth/naver/web";
export const NAVER_AUTHORIZE_URL = "https://nid.naver.com/oauth2/authorize";

export type WebProvider = "google" | "naver";

// TODO(SOMA-834 후속): 카카오·애플 웹 로그인. 지금 서버 POST /v2/auth/login 은 카카오를 "앱 키가 audience 인 id_token" 으로만
// 검증하고(KakaoProviderVerifier, KAKAO_OAUTH_CLIENT_ID 는 네이티브 앱 키), 웹용 카카오 REST/JS 키로 받은 토큰이나 인가 코드는
// 받지 않는다. 웹에서 켜려면 (1) 서버가 웹 키를 audience 로 받거나 authorization_code 교환을 지원하고 (2) 공개 키
// NEXT_PUBLIC_KAKAO_CLIENT_ID 를 주고 (3) 아래 상수를 true 로 바꿔 auth-flow.tsx 의 startKakao 자리를 채운다.
// 애플은 Services ID 와 리다이렉트 등록이 필요하다. 그때까지 두 버튼은 그리지 않는다.
export const KAKAO_WEB_ENABLED = false;
export const APPLE_WEB_ENABLED = false;

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
export function safeNext(value: string | null | undefined, origin?: string): string {
  const fallback = "/account";
  if (!value || !value.startsWith("/")) return fallback;
  // 역슬래시·제어문자는 브라우저가 "//" 로 읽어 밖의 사이트로 보낼 수 있다(/\evil.com, /%09/evil.com).
  if (/[\\\u0000-\u001f\u007f]/.test(value) || /%(0[0-9a-f]|1[0-9a-f]|7f|5c)/i.test(value)) return fallback;
  const base = origin ?? (typeof window === "undefined" ? "https://acttub.com" : window.location.origin);
  try {
    const url = new URL(value, base);
    if (url.origin !== new URL(base).origin) return fallback;
    if (url.pathname.startsWith("//")) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

export function rememberNext(next: string): void {
  sessionStorage.setItem(NEXT_KEY, safeNext(next));
}

/** 지우지 않고 읽는다(다시 로그인할 때 next 를 지키려고). */
export function peekNext(): string {
  return safeNext(sessionStorage.getItem(NEXT_KEY));
}

export function takeNext(): string {
  const value = sessionStorage.getItem(NEXT_KEY);
  sessionStorage.removeItem(NEXT_KEY);
  return safeNext(value);
}
