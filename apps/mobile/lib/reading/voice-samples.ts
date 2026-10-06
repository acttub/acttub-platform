import { Asset } from 'expo-asset';

import type { VoicePreset } from '@/lib/reading/voices';

/**
 * 고품질 목소리 미리 듣기 샘플(reading.cloud-voice). 서버가 프리셋을 1:1로 바꾸는 Gemini 목소리
 * (`CloudVoiceService.VOICES`, M1→Charon·F1→Kore…)와 같은 모델로 「안녕하세요, 오늘 같이 연습해요.」를 한 번 만들어
 * 앱에 넣었다 — 서버 호출·하루 한도·모델 내려받기 없이 연습 때 들을 목소리를 미리 듣는다. 매핑이 바뀌면 파일도 다시 만든다.
 */
const SAMPLES: Record<VoicePreset, number> = {
  M1: require('@/assets/audio/voice-preview-m1.m4a'),
  M2: require('@/assets/audio/voice-preview-m2.m4a'),
  M3: require('@/assets/audio/voice-preview-m3.m4a'),
  M4: require('@/assets/audio/voice-preview-m4.m4a'),
  M5: require('@/assets/audio/voice-preview-m5.m4a'),
  F1: require('@/assets/audio/voice-preview-f1.m4a'),
  F2: require('@/assets/audio/voice-preview-f2.m4a'),
  F3: require('@/assets/audio/voice-preview-f3.m4a'),
  F4: require('@/assets/audio/voice-preview-f4.m4a'),
  F5: require('@/assets/audio/voice-preview-f5.m4a'),
};

export async function cloudVoiceSampleUri(preset: VoicePreset): Promise<string> {
  const asset = Asset.fromModule(SAMPLES[preset]);
  await asset.downloadAsync();
  return asset.localUri ?? asset.uri;
}
