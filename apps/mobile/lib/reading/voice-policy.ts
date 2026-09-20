/**
 * 상대역 목소리 모델(Supertonic 3, 약 380MB)의 내려받기·실패 규칙(reading.cast). 처음 한 번 기기에 내려받고,
 * 앱은 Wi-Fi 가 아니면 용량을 보여 주고 확인을 받는다. 준비하지 못하면 자동으로 다른 음성으로 바꾸지 않고
 * 셋을 준다 — 다시 시도, 기기 음성으로 읽기(전달 안내와 함께, 배우가 고른 때만), 글로 보기(기본).
 */
export type NetworkType = 'wifi' | 'cellular' | 'none' | 'unknown';

export type DownloadPrompt = { ask: false } | { ask: true; sizeLabel: string };

export function formatMegabytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

export function modelDownloadPrompt(input: { assetsPresent: boolean; networkType: NetworkType; bytes: number }): DownloadPrompt {
  if (input.assetsPresent) return { ask: false };
  if (input.networkType === 'wifi') return { ask: false };
  return { ask: true, sizeLabel: formatMegabytes(input.bytes) };
}

export const VOICE_FAILURE_CHOICES = ['retry', 'device_voice', 'text_only'] as const;
export type VoiceFailureChoice = (typeof VOICE_FAILURE_CHOICES)[number];

/** 어느 경우에도 상대 대사를 읽은 것으로 자동 처리하지 않는다. 기본은 글로 보기다. */
export function voiceFallbackDefault(): VoiceFailureChoice {
  return 'text_only';
}

/** 상대 대사를 내는 방식. supertonic 이 기본, 실패 뒤 배우가 고른 대체. */
export type PartnerVoiceEngine = 'supertonic' | 'device_voice' | 'text_only';
