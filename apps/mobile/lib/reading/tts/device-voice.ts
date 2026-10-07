/**
 * 기기 기본 목소리(expo-speech, reading.cast). 앱 목소리를 못 쓰는 기기, 모델을 받지 않기로 한 회차, 고품질 목소리를
 * 못 받은 줄에서 상대 대사를 읽는다. OS 음성 서비스로 대사가 나갈 수 있다는 고지는 개인정보 처리방침에 둔다.
 * 프리셋마다 높낮이만 달리해 배역을 구분한다(voices.devicePitchFor).
 */
import * as Speech from 'expo-speech';

import { speechLocale } from '../../i18n.ts';
import { voiceSupportsLocale } from '../voice-capability.ts';
import { devicePitchFor } from '../voices.ts';

/** 기기에 지금 말(앱 표시 언어)의 음성이 있는가. 없으면 상대 대사는 글로 보인다. */
export async function hasDeviceVoice(): Promise<boolean> {
  try {
    return voiceSupportsLocale(await Speech.getAvailableVoicesAsync(), speechLocale());
  } catch {
    return false;
  }
}

export function speakWithDevice(text: string, preset: string, options: { rate?: number } = {}): Promise<void> {
  const clean = (text ?? '').trim();
  if (!clean) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    try {
      Speech.speak(clean, {
        language: speechLocale(),
        pitch: devicePitchFor(preset),
        rate: options.rate ?? 1.0,
        onDone: done,
        onStopped: done,
        onError: done,
      });
    } catch {
      done();
    }
  });
}

export function stopDeviceVoice(): void {
  void Speech.stop().catch(() => undefined);
}
