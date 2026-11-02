/**
 * 기기 기본 목소리(expo-speech, reading.cast). 앱 목소리를 못 쓰는 기기, 모델을 받지 않기로 한 회차, 고품질 목소리를
 * 못 받은 줄에서 상대 대사를 읽는다. OS 음성 서비스로 대사가 나갈 수 있다는 고지는 개인정보 처리방침에 둔다.
 * 프리셋마다 높낮이만 달리해 배역을 구분한다(voices.devicePitchFor).
 */
import * as Speech from 'expo-speech';

import { speechLocale } from '../../i18n.ts';
import { voiceSupportsLocale } from '../voice-capability.ts';
import { devicePitchFor } from '../voices.ts';
import { readingPlaybackRate } from './playback-rate.ts';

/** 기기에 지금 말(앱 표시 언어)의 음성이 있는가. 없으면 상대 대사는 글로 보인다. */
export async function hasDeviceVoice(): Promise<boolean> {
  try {
    return voiceSupportsLocale(await Speech.getAvailableVoicesAsync(), speechLocale());
  } catch {
    return false;
  }
}

/**
 * 멈추기는 네이티브에서 끝나기 전에 돌아온다. 줄을 넘기자마자 다음 줄을 읽으면 늦게 끝난 멈추기가 새 줄까지 끊을 수
 * 있어(연타하면 소리가 안 남), 읽기는 앞의 멈추기가 끝난 뒤에 시작한다. 기다리는 사이 또 멈췄으면 읽지 않는다.
 */
export const STOP_WAIT_MAX_MS = 500;
let stopping: Promise<void> | null = null;
let stopGeneration = 0;

/** locale 은 그 줄의 말의 지역 코드(SOMA-751, line-language.speechLocaleFor). 없으면 앱 표시 언어. */
export function speakWithDevice(text: string, preset: string, options: { rate?: number; locale?: string } = {}): Promise<void> {
  const clean = (text ?? '').trim();
  if (!clean) return Promise.resolve();
  const start = () =>
    new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      try {
        Speech.speak(clean, {
          language: options.locale ?? speechLocale(),
          pitch: devicePitchFor(preset),
          rate: options.rate ?? readingPlaybackRate(),
          onDone: done,
          onStopped: done,
          onError: done,
        });
      } catch {
        done();
      }
    });
  if (!stopping) return start();
  const generation = stopGeneration;
  return stopping.then(() => (generation === stopGeneration ? start() : undefined));
}

export function stopDeviceVoice(): void {
  stopGeneration += 1;
  // 멈추기가 끝을 알리지 않아도 다음 줄이 소리 없이 갇히지 않게 잠깐만 기다린다.
  const current: Promise<void> = Promise.race([
    Speech.stop().catch(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, STOP_WAIT_MAX_MS)),
  ]);
  stopping = current;
  void current.then(() => {
    if (stopping === current) stopping = null;
  });
}
