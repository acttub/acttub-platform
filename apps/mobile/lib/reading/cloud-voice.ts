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

export function shouldUseCloudVoice(input: { enabled: boolean; status: CloudVoiceStatus | null }): boolean {
  const { enabled, status } = input;
  return !!(enabled && status?.available && status.consent === 'granted' && status.daily_used < status.daily_limit);
}

export function shouldStopCloudVoiceForSession(error: { status?: number } | null | undefined): boolean {
  return error?.status === 429 || error?.status === 503;
}

export function cloudVoiceFallback(input: { cloudAttempted: boolean; cloudSucceeded: boolean; deviceReady: boolean }) {
  const failed = input.cloudAttempted && !input.cloudSucceeded;
  return { useDevice: failed && input.deviceReady, textOnly: failed && !input.deviceReady };
}

type Storage = { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void> };
function storage(): Storage {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('@react-native-async-storage/async-storage').default as Storage;
}

export async function loadCloudVoiceEnabled(): Promise<boolean> {
  try { return (await storage().getItem(CLOUD_VOICE_KEY)) === 'on'; } catch { return false; }
}

export async function saveCloudVoiceEnabled(enabled: boolean): Promise<void> {
  await storage().setItem(CLOUD_VOICE_KEY, enabled ? 'on' : 'off');
}

/** 동의 시트가 제목을 따로 보여 주므로 문서 첫 줄의 `# 제목` 은 떼고 본문만 그린다. */
export function consentBodyWithoutTitle(body: string): string {
  return body.replace(/^#\s[^\n]*\n+/, '');
}
