import AsyncStorage from '@react-native-async-storage/async-storage';

import { api } from './api';
import { parseAppConfig, setAppConfig } from './app-config';

/** 마지막으로 받은 서버 설정 원본(JSON) — 다음 실행에서 서버보다 먼저 쓴다(SOMA-939). */
const CACHE_KEY = 'acttub.appConfig';

/**
 * 앱을 켤 때 한 번 부른다(SOMA-939). 기기에 남긴 설정을 먼저 쓰고, 서버에서 새로 받으면 바꿔 끼우고 남긴다.
 * 어떤 실패든 삼킨다 — 기본값이나 남긴 값으로 그대로 돈다.
 */
export async function loadAppConfig(): Promise<void> {
  try {
    const cached = await AsyncStorage.getItem(CACHE_KEY);
    if (cached) setAppConfig(parseAppConfig(JSON.parse(cached)));
  } catch {
    // 깨진 캐시는 무시한다
  }
  try {
    const raw = await api.getAppConfig();
    setAppConfig(parseAppConfig(raw));
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(raw));
  } catch {
    // 서버에 못 닿으면 지금 값 그대로
  }
}
