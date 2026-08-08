import * as SecureStore from 'expo-secure-store';

import { createAuthCredentialStore } from '@/lib/auth-credentials';
import type { AuthUser } from '@/lib/api';
import {
  createCredentialMutationQueue,
  type CredentialExpectation,
  type RefreshCommitResult,
} from '@/lib/credential-mutation-queue';

/**
 * v2 인증 토큰(JWT) 저장소.
 * access/refresh 토큰을 SecureStore(키체인/keystore)에 두고, 앱 구동 중엔 메모리 캐시로 빠르게 읽는다.
 * 토큰이 비워질 때(로그아웃·refresh 실패) 구독자에게 알려 로그인 화면으로 게이트한다.
 */

const credentialMutationQueue = createCredentialMutationQueue(
  createAuthCredentialStore({
    getItem: (key) => SecureStore.getItemAsync(key),
    setItem: (key, value) => SecureStore.setItemAsync(key, value),
    deleteItem: (key) => SecureStore.deleteItemAsync(key),
  }),
);

type Listener = () => void;
type UserListener = (user: AuthUser) => void;
const consentRequiredListeners = new Set<Listener>();
const accountDeactivatedListeners = new Set<Listener>();

/** 토큰이 비워졌을 때(로그아웃·세션 만료) 호출된다. 구독 해제 함수를 반환. */
export function onTokensCleared(fn: Listener): () => void {
  return credentialMutationQueue.onTokensCleared(fn);
}

/** 보호 API가 필수 동의를 요구할 때 호출된다. 구독 해제 함수를 반환. */
export function onConsentRequired(fn: Listener): () => void {
  consentRequiredListeners.add(fn);
  return () => consentRequiredListeners.delete(fn);
}

/** refresh가 legacy principal을 교정했을 때 인증 컨텍스트에 새 user를 알린다. */
export function onStoredUserChanged(fn: UserListener): () => void {
  return credentialMutationQueue.onStoredUserChanged(fn);
}

export function emitConsentRequired(): void {
  for (const fn of consentRequiredListeners) fn();
}

/**
 * 서버가 이 계정을 탈퇴한 것으로 볼 때 호출된다. 구독 해제 함수를 반환.
 *
 * 탈퇴한 뒤에도 액세스 토큰은 만료까지 형식상 유효해서, 앱이 그대로 로그인된 것처럼
 * 보이는데 모든 보호 요청이 403 으로 막힌다. 다른 기기에서 탈퇴한 경우도 같다.
 * 그래서 401(만료)과 달리 refresh 로 풀 수 없고, 세션을 끊어 내보내는 수밖에 없다.
 */
export function onAccountDeactivated(fn: Listener): () => void {
  accountDeactivatedListeners.add(fn);
  return () => accountDeactivatedListeners.delete(fn);
}

export function emitAccountDeactivated(): void {
  for (const fn of accountDeactivatedListeners) fn();
}

/** 앱 시작 시 저장된 토큰을 메모리로 로드한다 (1회). */
export async function loadTokens(): Promise<boolean> {
  return credentialMutationQueue.loadTokens();
}

/** 보호 요청이 최초 SecureStore credential 복원을 관측한 뒤 시작되도록 한다. */
export async function waitForCredentialReady(): Promise<void> {
  await credentialMutationQueue.waitForCredentialReady();
}

export function getAccessToken(): string | null {
  return credentialMutationQueue.getAccessToken();
}

export function getRefreshToken(): string | null {
  return credentialMutationQueue.getRefreshToken();
}

export function getStoredUser(): AuthUser | null {
  return credentialMutationQueue.getStoredUser();
}

/** 로그인·로그아웃 경계를 나타낸다. refresh token rotation에서는 바뀌지 않는다. */
export function getAuthSessionEpoch(): number {
  return credentialMutationQueue.getAuthSessionEpoch();
}

export async function setTokens(
  access: string,
  refresh: string,
  user: AuthUser,
): Promise<boolean> {
  return credentialMutationQueue.setLoginTokens(access, refresh, user);
}

export async function commitRefreshedTokens(
  access: string,
  refresh: string,
  expectation: CredentialExpectation,
): Promise<RefreshCommitResult> {
  return credentialMutationQueue.commitRefresh(access, refresh, expectation);
}

export async function clearTokens(): Promise<void> {
  await credentialMutationQueue.clearTokens();
}

export async function clearTokensIfCurrent(
  expectation: CredentialExpectation,
): Promise<boolean> {
  return credentialMutationQueue.clearTokensIfCurrent(expectation);
}
