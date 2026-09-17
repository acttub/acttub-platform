import * as SecureStore from 'expo-secure-store';

/**
 * 사용자 이름 로컬 저장.
 * 현재 백엔드에 이름 저장 필드/엔드포인트가 없어 로컬(SecureStore)에 임시 보관한다.
 * 서버에 프로필 API가 생기면 saveUserName에서 함께 전송하도록 바꾸면 된다.
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
 * 로그인 제공자(구글·애플)가 준 이름 힌트 — 저장하지 않고 들고만 있다.
 *
 * 예전엔 이 이름을 바로 저장했는데, 그러면 "이름이 있다 = 프로필 설정 끝"으로 판정돼
 * 새 가입자에게 프로필 설정 화면(A0.2)이 한 번도 안 떴다. 지금은 프로필 폼이 이 힌트를
 * 첫 값으로 채우고, 사용자가 시작하기를 눌러야 비로소 저장한다.
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
