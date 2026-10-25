export type CloudVoiceConsent = 'granted' | 'denied' | 'undecided';

export type CloudVoiceStatus = {
  available: boolean;
  free_until: string | null;
  consent: CloudVoiceConsent;
  daily_limit: number;
  daily_used: number;
};

export type CloudVoicePreset = 'M1' | 'M2' | 'M3' | 'M4' | 'M5' | 'F1' | 'F2' | 'F3' | 'F4' | 'F5';

/** 고품질 목소리는 기기에서 끄지 않는다(SOMA-841) — 서버가 쓰게 하고 동의했고 한도가 남았으면 쓴다. */
export function shouldUseCloudVoice(status: CloudVoiceStatus | null): boolean {
  return !!(status?.available && status.consent === 'granted' && status.daily_used < status.daily_limit);
}

export function shouldStopCloudVoiceForSession(error: { status?: number } | null | undefined): boolean {
  return error?.status === 429 || error?.status === 503;
}

/** 요청 자체가 잘못됐다는 거절 — 같은 줄을 다시 보내도 같은 답이다. */
export function isRejectedCloudVoiceRequest(error: { status?: number } | null | undefined): boolean {
  return error?.status === 400;
}

/** 동의 시트가 제목을 따로 보여 주므로 문서 첫 줄의 `# 제목` 은 떼고 본문만 그린다. */
export function consentBodyWithoutTitle(body: string): string {
  return body.replace(/^#\s[^\n]*\n+/, '');
}
