import AsyncStorage from '@react-native-async-storage/async-storage';

import { resetPracticeState } from '@/lib/practice';
import { deleteUserName } from '@/lib/profile';

/**
 * 이 기기에 남은 내 자료를 지운다.
 *
 * 탈퇴는 서버에서 이메일·닉네임·로그인 연결을 파기하는데, 기기에도 같은 것들이 남아
 * 있다 — 이름은 SecureStore, 동의 기록·본 적 있음 표시·중단된 분석은 AsyncStorage.
 * 서버만 지우고 여기를 두면 다음에 켰을 때 떠난 사람의 이름이 그대로 뜬다.
 *
 * 키를 하나씩 나열하지 않고 `acttub.` 접두사로 쓸어내는 이유: 저장소를 새로 하나
 * 늘릴 때마다 이 목록에 추가하는 걸 잊으면 조용히 남는다. 지워서 문제가 되는 것은
 * 이 접두사 아래에 두지 않는다.
 */
const KEY_PREFIX = 'acttub.';

export async function clearLocalAccountData(): Promise<void> {
  // 메모리에만 있는 것부터. 실패할 수 없고, 아래가 느려도 화면이 먼저 비워진다.
  resetPracticeState();
  // 하나가 실패해도 나머지는 지운다. 절반이라도 지우는 게 전부 남기는 것보다 낫다.
  await Promise.allSettled([clearAsyncStorage(), deleteUserName()]);
}

async function clearAsyncStorage(): Promise<void> {
  const keys = await AsyncStorage.getAllKeys();
  const mine = keys.filter((key) => key.startsWith(KEY_PREFIX));
  if (mine.length > 0) await AsyncStorage.multiRemove(mine);
}
