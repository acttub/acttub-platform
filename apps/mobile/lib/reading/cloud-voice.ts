export type CloudVoiceConsent = 'granted' | 'denied' | 'undecided';

export type CloudVoiceStatus = {
  available: boolean;
  free_until: string | null;
  consent: CloudVoiceConsent;
  daily_limit: number;
  daily_used: number;
};

export type CloudVoicePreset = 'M1' | 'M2' | 'M3' | 'M4' | 'M5' | 'F1' | 'F2' | 'F3' | 'F4' | 'F5';
export const CLOUD_VOICE_KEY = 'acttub.cloudVoice';

/**
 * lines 는 이번 회차에 서버 음성으로 읽을 상대 대사 수. 남은 하루 한도가 그보다 적으면 회차 중간에 한도(429)에 걸려 남은 줄을
 * 기기 목소리로 읽게 되고, 같은 배역의 목소리가 중간에 바뀐다(SOMA-912). 그런 회차는 처음부터 앱 목소리로 읽는다.
 * 서버에 저장본이 있는 줄은 한도를 쓰지 않지만 기기는 알 수 없어 모두 센다.
 */
export function shouldUseCloudVoice(input: { enabled: boolean; status: CloudVoiceStatus | null; lines?: number }): boolean {
  const { enabled, status, lines = 0 } = input;
  return !!(
    enabled &&
    status?.available &&
    status.consent === 'granted' &&
    status.daily_used < status.daily_limit &&
    lines <= status.daily_limit - status.daily_used
  );
}

export function shouldStopCloudVoiceForSession(error: { status?: number } | null | undefined): boolean {
  return error?.status === 429 || error?.status === 503;
}

/** 요청 자체가 잘못됐다는 거절 — 같은 줄을 다시 보내도 같은 답이다. */
export function isRejectedCloudVoiceRequest(error: { status?: number } | null | undefined): boolean {
  return error?.status === 400;
}

type Storage = { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void> };
function storage(): Storage {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('@react-native-async-storage/async-storage').default as Storage;
}

export async function loadCloudVoiceEnabled(): Promise<boolean> {
  // 기본은 켜짐(10/25 사용자 결정) — 끈 적이 있을 때만 끈다. 켜져 있어도 동의·서버 한도가 따로 막는다(shouldUseCloudVoice).
  try { return (await storage().getItem(CLOUD_VOICE_KEY)) !== 'off'; } catch { return true; }
}

export async function saveCloudVoiceEnabled(enabled: boolean): Promise<void> {
  await storage().setItem(CLOUD_VOICE_KEY, enabled ? 'on' : 'off');
}

/** 동의 시트가 제목을 따로 보여 주므로 문서 첫 줄의 `# 제목` 은 떼고 본문만 그린다. */
export function consentBodyWithoutTitle(body: string): string {
  return body.replace(/^#\s[^\n]*\n+/, '');
}
