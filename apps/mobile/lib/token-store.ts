import * as SecureStore from 'expo-secure-store';

/**
 * v2 인증 토큰(JWT) 저장소.
 * access/refresh 토큰을 SecureStore(키체인/keystore)에 두고, 앱 구동 중엔 메모리 캐시로 빠르게 읽는다.
 * 토큰이 비워질 때(로그아웃·refresh 실패) 구독자에게 알려 로그인 화면으로 게이트한다.
 */

const ACCESS_KEY = 'acttub.accessToken';
const REFRESH_KEY = 'acttub.refreshToken';

let accessToken: string | null = null;
let refreshToken: string | null = null;
let loaded = false;

type Listener = () => void;
const clearedListeners = new Set<Listener>();

/** 토큰이 비워졌을 때(로그아웃·세션 만료) 호출된다. 구독 해제 함수를 반환. */
export function onTokensCleared(fn: Listener): () => void {
  clearedListeners.add(fn);
  return () => clearedListeners.delete(fn);
}

/** 앱 시작 시 저장된 토큰을 메모리로 로드한다 (1회). */
export async function loadTokens(): Promise<boolean> {
  if (loaded) return accessToken !== null;
  try {
    accessToken = await SecureStore.getItemAsync(ACCESS_KEY);
    refreshToken = await SecureStore.getItemAsync(REFRESH_KEY);
  } catch {
    accessToken = null;
    refreshToken = null;
  }
  loaded = true;
  return accessToken !== null;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function getRefreshToken(): string | null {
  return refreshToken;
}

export async function setTokens(access: string, refresh: string): Promise<void> {
  accessToken = access;
  refreshToken = refresh;
  loaded = true;
  await SecureStore.setItemAsync(ACCESS_KEY, access);
  await SecureStore.setItemAsync(REFRESH_KEY, refresh);
}

export async function clearTokens(): Promise<void> {
  accessToken = null;
  refreshToken = null;
  loaded = true;
  try {
    await SecureStore.deleteItemAsync(ACCESS_KEY);
    await SecureStore.deleteItemAsync(REFRESH_KEY);
  } catch {
    // 삭제 실패해도 메모리는 이미 비웠으니 로그아웃으로 간주
  }
  for (const fn of clearedListeners) fn();
}
