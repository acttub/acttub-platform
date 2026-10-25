/**
 * 네이버 로그인의 순수한 부분(account.login, 결정 I-5).
 *
 * 앱은 네이버 SDK 대신 브라우저 인증 세션으로 OIDC 인가 코드를 받는다. PKCE(S256)와 state 를 앱이
 * 만들고, 코드 교환은 client secret 을 가진 서버가 한다. 네이버는 콜백 주소로 http(s)만 받으므로
 * 콜백은 웹의 `/auth/naver/callback`(API 와 같은 호스트)이고, 그 페이지가 받은 값을 그대로 앱
 * 스킴(`actingapp://auth/naver`)으로 넘긴다. 서버의 코드 교환이 OIDC 경로(`/oauth2/token`)라 인가
 * 요청도 OIDC 경로(`/oauth2/authorize`, scope=openid)여야 ID 토큰이 나온다.
 *
 * 네이티브 모듈(난수·해시·브라우저)은 부르는 쪽이 넘긴다. RN 의 URL 구현은 일부만 있어 쓰지 않는다.
 */
export const NAVER_AUTHORIZE_URL = 'https://nid.naver.com/oauth2/authorize';
export const NAVER_CALLBACK_PATH = '/auth/naver/callback';
/** 웹 콜백 페이지가 결과를 넘기는 앱 주소. 앱 스킴은 app.json 의 scheme 이다. */
export const NAVER_APP_RETURN_URL = 'actingapp://auth/naver';

const DEFAULT_API_URL = 'https://dev.acttub.com';

export type NaverAuthRequest = {
  url: string;
  state: string;
  codeVerifier: string;
  redirectUri: string;
};

export type NaverCrypto = {
  randomBytes: (count: number) => Uint8Array;
  sha256: (data: Uint8Array<ArrayBuffer>) => Promise<Uint8Array>;
};

/** 네이버 콘솔에 등록하는 Callback URL. 앱이 보는 API 와 같은 호스트의 웹 페이지다. */
export function naverRedirectUri(apiUrl: string | undefined): string {
  const base = (apiUrl ?? '').trim().replace(/\/+$/, '') || DEFAULT_API_URL;
  return `${base}${NAVER_CALLBACK_PATH}`;
}

const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** 채움 문자 없는 base64url(RFC 4648 §5). PKCE 의 verifier·challenge 형식이다. */
export function base64Url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out += BASE64URL[a >> 2];
    out += BASE64URL[((a & 3) << 4) | ((b ?? 0) >> 4)];
    if (b !== undefined) out += BASE64URL[((b & 15) << 2) | ((c ?? 0) >> 6)];
    if (c !== undefined) out += BASE64URL[c & 63];
  }
  return out;
}

function asciiBytes(value: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i += 1) bytes[i] = value.charCodeAt(i);
  return bytes;
}

/** 인가 요청 하나. verifier 는 32바이트(43자), state 는 16바이트 난수다. */
export async function naverAuthRequest(options: {
  clientId: string;
  apiUrl: string | undefined;
  crypto: NaverCrypto;
}): Promise<NaverAuthRequest> {
  const { clientId, apiUrl, crypto } = options;
  const codeVerifier = base64Url(crypto.randomBytes(32));
  const state = base64Url(crypto.randomBytes(16));
  const codeChallenge = base64Url(await crypto.sha256(asciiBytes(codeVerifier)));
  const redirectUri = naverRedirectUri(apiUrl);
  const query = [
    ['response_type', 'code'],
    ['client_id', clientId],
    ['redirect_uri', redirectUri],
    ['state', state],
    ['scope', 'openid'],
    ['code_challenge', codeChallenge],
    ['code_challenge_method', 'S256'],
  ]
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&');
  return { url: `${NAVER_AUTHORIZE_URL}?${query}`, state, codeVerifier, redirectUri };
}

function queryParams(url: string): Record<string, string> {
  const params: Record<string, string> = {};
  const start = url.indexOf('?');
  if (start < 0) return params;
  const end = url.indexOf('#', start);
  const query = url.slice(start + 1, end < 0 ? undefined : end);
  for (const pair of query.split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    const decode = (part: string) => decodeURIComponent(part.replace(/\+/g, ' '));
    const key = decode(eq < 0 ? pair : pair.slice(0, eq));
    if (!(key in params)) params[key] = eq < 0 ? '' : decode(pair.slice(eq + 1));
  }
  return params;
}

/** 네이버가 앱 주소로 돌려보낸 결과(웹 콜백 페이지가 그대로 넘긴 것)인가. */
export function isNaverReturnUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return (
    lower === NAVER_APP_RETURN_URL ||
    lower.startsWith(`${NAVER_APP_RETURN_URL}?`) ||
    lower.startsWith(`${NAVER_APP_RETURN_URL}/`) ||
    lower.startsWith(`${NAVER_APP_RETURN_URL}#`)
  );
}

/**
 * 돌아온 주소에서 인가 코드를 꺼낸다. 우리가 보낸 state 와 다르면 남이 끼워 넣은 응답일 수 있어
 * 던진다. 사용자가 동의 화면에서 취소하면(access_denied) null, 다른 오류와 코드 없음은 던진다.
 */
export function naverCallbackCode(url: string, expectedState: string): string | null {
  const params = queryParams(url);
  if (!params.state || params.state !== expectedState) {
    throw new Error('Naver sign-in returned a mismatched state');
  }
  if (params.error) {
    if (params.error === 'access_denied') return null;
    throw new Error(`Naver sign-in failed: ${params.error}`);
  }
  if (!params.code) throw new Error('Naver sign-in returned no authorization code');
  return params.code;
}
