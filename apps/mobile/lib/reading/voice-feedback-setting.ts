/**
 * 발성 피드백(실험) 켜기·끄기. 기기에만 둔다 — 기본은 꺼짐. 켜면 리딩이 끝난 화면에 내 대사별 칩이 나온다.
 */
export const VOICE_FEEDBACK_KEY = 'acttub.reading.voiceFeedback';

type Storage = { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void> };
function storage(): Storage {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('@react-native-async-storage/async-storage').default as Storage;
}

export async function loadVoiceFeedbackEnabled(store: Storage = storage()): Promise<boolean> {
  try {
    return (await store.getItem(VOICE_FEEDBACK_KEY)) === '1';
  } catch {
    return false;
  }
}

export async function saveVoiceFeedbackEnabled(value: boolean, store: Storage = storage()): Promise<void> {
  await store.setItem(VOICE_FEEDBACK_KEY, value ? '1' : '0');
}
