import * as SecureStore from 'expo-secure-store';

import { createAuthCredentialStore } from '@/lib/auth-credentials';
import type { AuthUser } from '@/lib/api';

/**
 * v2 인증 토큰(JWT) 저장소.
 * access/refresh 토큰을 SecureStore(키체인/keystore)에 두고, 앱 구동 중엔 메모리 캐시로 빠르게 읽는다.
 * 토큰이 비워질 때(로그아웃·refresh 실패) 구독자에게 알려 로그인 화면으로 게이트한다.
 */

const credentialStore = createAuthCredentialStore({
  getItem: (key) => SecureStore.getItemAsync(key),
  setItem: (key, value) => SecureStore.setItemAsync(key, value),
  deleteItem: (key) => SecureStore.deleteItemAsync(key),
});

let accessToken: string | null = null;
let refreshToken: string | null = null;
let authUser: AuthUser | null = null;
let loaded = false;
let authSessionEpoch = 0;

type Listener = () => void;
const clearedListeners = new Set<Listener>();
const consentRequiredListeners = new Set<Listener>();

/** 토큰이 비워졌을 때(로그아웃·세션 만료) 호출된다. 구독 해제 함수를 반환. */
export function onTokensCleared(fn: Listener): () => void {
  clearedListeners.add(fn);
  return () => clearedListeners.delete(fn);
}

/** 보호 API가 필수 동의를 요구할 때 호출된다. 구독 해제 함수를 반환. */
export function onConsentRequired(fn: Listener): () => void {
  consentRequiredListeners.add(fn);
  return () => consentRequiredListeners.delete(fn);
}

export function emitConsentRequired(): void {
  for (const fn of consentRequiredListeners) fn();
}

/** 앱 시작 시 저장된 토큰을 메모리로 로드한다 (1회). */
export async function loadTokens(): Promise<boolean> {
  if (loaded) return accessToken !== null && refreshToken !== null && authUser !== null;
  try {
    const credentials = await credentialStore.load();
    accessToken = credentials?.accessToken ?? null;
    refreshToken = credentials?.refreshToken ?? null;
    authUser = credentials?.user ?? null;
  } catch {
    accessToken = null;
    refreshToken = null;
    authUser = null;
  }
  loaded = true;
  return accessToken !== null && refreshToken !== null && authUser !== null;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function getRefreshToken(): string | null {
  return refreshToken;
}

export function getStoredUser(): AuthUser | null {
  return authUser;
}

/** 로그인·로그아웃 경계를 나타낸다. refresh token rotation에서는 바뀌지 않는다. */
export function getAuthSessionEpoch(): number {
  return authSessionEpoch;
}

export async function setTokens(
  access: string,
  refresh: string,
  user?: AuthUser,
): Promise<void> {
  const nextUser = user ?? authUser;
  if (!nextUser) throw new Error('사용자 정보 없이 인증 credential을 저장할 수 없습니다.');
  await credentialStore.save(access, refresh, nextUser);
  accessToken = access;
  refreshToken = refresh;
  if (user) {
    authUser = user;
    authSessionEpoch += 1;
  }
  loaded = true;
}

export async function clearTokens(): Promise<void> {
  accessToken = null;
  refreshToken = null;
  authUser = null;
  loaded = true;
  authSessionEpoch += 1;
  try {
    await credentialStore.clear();
  } catch {
    // 삭제 실패해도 메모리는 이미 비웠으니 로그아웃으로 간주
  }
  for (const fn of clearedListeners) fn();
}
