import * as SecureStore from 'expo-secure-store';

/**
 * 사용자 이름의 기기 캐시(SecureStore).
 * 정본은 서버의 프로필 이름(GET /v2/me의 profile.name)이다. 인증 컨텍스트가 프로필을 읽거나
 * 저장할 때마다 여기에 옮겨 적고, 홈 인사말과 프로필 탭이 서버를 기다리지 않고 읽는다.
 * 프로필 게이트는 이 값을 보지 않는다.
 */
const NAME_KEY = 'acttub.userName';

export async function saveUserName(name: string): Promise<void> {
  await SecureStore.setItemAsync(NAME_KEY, name.trim());
}

/** 탈퇴할 때 부른다. 이름은 개인정보라 기기에도 남기지 않는다. */
export async function deleteUserName(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(NAME_KEY);
  } catch {
    // 이미 없으면 그걸로 됐다.
  }
}

export async function getUserName(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(NAME_KEY);
  } catch {
    return null;
  }
}

/**
 * 로그인 제공자가 준 이름 힌트 — 저장하지 않고 들고만 있다.
 *
 * 프로필 폼이 이름 칸의 첫 값으로만 쓰고, 저장되는 것은 배우가 확인한 값이다. 애플은 이름을
 * 첫 로그인 한 번만 주므로 동의 화면을 지나 프로필 화면까지 들고 간다. 가입 중의 동의
 * 화면에서 나가면 함께 버린다.
 */
let providerNameHint: string | null = null;

export function setProviderNameHint(name: string | null | undefined): void {
  const trimmed = name?.trim();
  providerNameHint = trimmed ? trimmed : null;
}

/** 힌트를 꺼내며 비운다 — 프로필 폼이 한 번만 쓴다. */
export function takeProviderNameHint(): string | null {
  const v = providerNameHint;
  providerNameHint = null;
  return v;
}
