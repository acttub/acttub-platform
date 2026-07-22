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

export async function getUserName(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(NAME_KEY);
  } catch {
    return null;
  }
}
