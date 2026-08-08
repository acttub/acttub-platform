export type AuthUser = {
  id: string;
  email: string | null;
  status: "active" | "suspended" | "deactivated";
};

export type TokenPair = {
  access_token: string;
  refresh_token: string;
};

const ACCESS_KEY = "acttub.access_token";
const REFRESH_KEY = "acttub.refresh_token";
const USER_KEY = "acttub.user";

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

export function isLoggedIn(): boolean {
  return Boolean(getRefreshToken());
}

// 다른 탭에서 로그아웃/토큰 회전이 일어나면 메모리 캐시를 무효화한다.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === ACCESS_KEY) memoryAccess = event.newValue;
    if (event.key === REFRESH_KEY) memoryRefresh = event.newValue;
  });
}
