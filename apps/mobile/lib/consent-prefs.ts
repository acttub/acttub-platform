import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * 선택 동의(및 필수 포함) 상태의 로컬 캐시.
 * 서버가 "내가 어떤 문서에 동의했는지"를 주는 GET이 없어서, 사용자가 고른 값을 로컬에 저장해
 * 설정 화면 토글에 반영한다. 실제 기록은 항상 서버(POST /v2/consents)로도 보낸다.
 */
const KEY = 'acttub.consentPrefs';

export async function getConsentPrefs(): Promise<Record<string, boolean>> {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, boolean>;
  } catch {
    return {};
  }
}

export async function saveConsentPrefs(prefs: Record<string, boolean>): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(prefs));
}

export async function setConsentPref(docId: string, granted: boolean): Promise<void> {
  const prefs = await getConsentPrefs();
  prefs[docId] = granted;
  await saveConsentPrefs(prefs);
}
