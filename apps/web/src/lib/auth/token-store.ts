export type AuthUser = {
  id: string;
  email: string | null;
  status: "active" | "deactivated";
};

export type TokenPair = {
  access_token: string;
  refresh_token: string;
};

// 웹에는 로그인이 없고 이 토큰은 언제나 게스트의 것이다(account.guest). 1.0.0 이전에는 같은
// 자리에 회원 토큰을 두었으므로 키를 새로 잡는다 — 옛 키의 회원 토큰을 그대로 쓰면 회원
// 게이트(프로필 입력)에 막히는데 웹에는 그 화면이 없다.
const ACCESS_KEY = "acttub.guest.access_token";
export const REFRESH_KEY = "acttub.guest.refresh_token";
const USER_KEY = "acttub.guest.user";

// 1.0.0 이전 웹 로그인이 남긴 것. 배포 뒤 웹 세션은 끝나고 자료는 계정에 그대로 있다.
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
    if (event.key === ACCESS_KEY) memoryAccess = event.newValue;
    if (event.key === REFRESH_KEY) memoryRefresh = event.newValue;
  });
}
