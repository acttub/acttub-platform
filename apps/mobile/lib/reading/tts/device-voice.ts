/**
 * 기기 음성으로 읽기(reading.cast의 대체 셋 중 하나). Supertonic 을 준비하지 못했을 때 배우가 고른 경우에만
 * 쓴다 — OS 음성 서비스로 대사가 전달될 수 있어 화면이 한 줄로 알린다(확정 결정 6의 예외).
 * 프리셋마다 높낮이만 달리해 배역을 구분한다(voices.devicePitchFor).
 */
import * as Speech from 'expo-speech';

import { speechLocale } from '../../i18n.ts';
import { devicePitchFor } from '../voices.ts';

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
