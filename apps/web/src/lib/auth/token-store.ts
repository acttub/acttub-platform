export type AuthUser = {
  id: string;
  email: string | null;
  status: "active" | "deactivated";
};

export type TokenPair = {
  access_token: string;
  refresh_token: string;
};

// 이 자리의 토큰은 게스트의 것이거나, /login 으로 로그인한 회원의 것이다(account.login 웹 로그인,
// SOMA-834). 회원이면 MEMBER_KEY 가 함께 있다. 0.1.0 이전 웹 로그인이 쓰던 옛 키는 아래에서 지운다.
const ACCESS_KEY = "acttub.guest.access_token";
export const REFRESH_KEY = "acttub.guest.refresh_token";
const USER_KEY = "acttub.guest.user";
// 지금 토큰이 회원의 것인지와 로그인한 제공자. 토큰과 같이 생기고 같이 지워진다(clearTokens).
const MEMBER_KEY = "acttub.web.member_provider";

// 0.1.0 이전 웹 로그인이 남긴 것. 배포 뒤 웹 세션은 끝나고 자료는 계정에 그대로 있다.
const LEGACY_KEYS = [
  "acttub.access_token",
  "acttub.refresh_token",
  "acttub.user",
  "acttub.pending_consents",
  "acttub.accepted_privacy_version",
  "acttub.display_names",
];

// 정적 prerender 중에는 window가 없으므로 모든 접근을 가드한다.
const storage = (): Storage | null =>
  typeof window === "undefined" ? null : window.localStorage;

let memoryAccess: string | null = null;
let memoryRefresh: string | null = null;

export function getAccessToken(): string | null {
  return memoryAccess ?? storage()?.getItem(ACCESS_KEY) ?? null;
}

export function getRefreshToken(): string | null {
  return memoryRefresh ?? storage()?.getItem(REFRESH_KEY) ?? null;
}

export function getStoredUser(): AuthUser | null {
  const raw = storage()?.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

export function setTokens(pair: TokenPair, user?: AuthUser): void {
  memoryAccess = pair.access_token;
  memoryRefresh = pair.refresh_token;
  const store = storage();
  if (!store) return;
  store.setItem(ACCESS_KEY, pair.access_token);
  store.setItem(REFRESH_KEY, pair.refresh_token);
  if (user) store.setItem(USER_KEY, JSON.stringify(user));
}

export function clearTokens(): void {
  memoryAccess = null;
  memoryRefresh = null;
  const store = storage();
  if (!store) return;
  store.removeItem(ACCESS_KEY);
  store.removeItem(REFRESH_KEY);
  store.removeItem(USER_KEY);
  store.removeItem(MEMBER_KEY);
}

/** 방금 로그인한 회원의 토큰을 게스트 자리에 넣는다. 게스트 토큰은 덮인다. */
export function setMemberTokens(pair: TokenPair, user: AuthUser, provider: string): void {
  setTokens(pair, user);
  storage()?.setItem(MEMBER_KEY, provider);
}

/** 로그인한 제공자(google·naver…). 회원 세션이 아니면 null. */
export function memberProvider(): string | null {
  if (!getRefreshToken()) return null;
  return storage()?.getItem(MEMBER_KEY) ?? null;
}

export function isMemberSession(): boolean {
  return memberProvider() !== null;
}

/** 이 브라우저에 게스트가 있는지. 리프레시 토큰이 곧 그 게스트에 닿는 유일한 길이다. */
export function hasGuestSession(): boolean {
  return Boolean(getRefreshToken());
}

if (typeof window !== "undefined") {
  try {
    for (const key of LEGACY_KEYS) window.localStorage.removeItem(key);
  } catch {
    // 저장소가 막힌 환경에는 지울 것도 없다.
  }
  // 다른 탭에서 토큰 회전이나 게스트 끝이 일어나면 메모리 캐시를 무효화한다.
  window.addEventListener("storage", (event) => {
    // key null 은 다른 탭의 localStorage.clear() 다.
    if (event.key === null) {
      memoryAccess = null;
      memoryRefresh = null;
    }
    if (event.key === ACCESS_KEY) memoryAccess = event.newValue;
    if (event.key === REFRESH_KEY) memoryRefresh = event.newValue;
  });
}
