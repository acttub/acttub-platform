import AsyncStorage from '@react-native-async-storage/async-storage';

import { api } from '@/lib/api';
import { forgetLocalCopy } from '@/lib/library/library-runner';

/**
 * 올리기 옵션(P3.26) 중 「분석 끝나면 영상 바로 지우기」를 회차별로 기억한다.
 * 앱을 껐다 켜도 지켜지도록 AsyncStorage 에 회차 id → 영상 id 로 적어 두고, 분석이 끝나 노트가 열리는
 * 시점에 purgeVideoFileIfDue 가 서버에 파일 파기를 요청한다. 실패하면 적어 둔 채로 남겨 다음에 다시 시도한다.
 */
const KEY = 'acttub.practice.purgeAfterAnalysis';

async function read(): Promise<Record<string, string>> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export async function rememberPurgeAfterAnalysis(practiceId: string, videoId: string): Promise<void> {
  const all = await read();
  all[practiceId] = videoId;
  await AsyncStorage.setItem(KEY, JSON.stringify(all)).catch(() => undefined);
}

export async function isPurgeAfterAnalysis(practiceId: string): Promise<boolean> {
  return Boolean((await read())[practiceId]);
}

/** 분석이 끝난(노트가 열린) 회차에서 부른다. 지울 영상이 있었고 지웠으면 true. */
export async function purgeVideoFileIfDue(practiceId: string): Promise<boolean> {
  const all = await read();
  const videoId = all[practiceId];
  if (!videoId) return false;
  try {
    await api.purgeVideoFile(videoId);
  } catch {
    return false;
  }
  await forgetLocalCopy(videoId).catch(() => undefined);
  delete all[practiceId];
  await AsyncStorage.setItem(KEY, JSON.stringify(all)).catch(() => undefined);
  return true;
}
