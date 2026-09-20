import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { useCallback, useRef, useState } from 'react';

import { speechLocale } from '@/lib/i18n';
import { sttPolicy, type SttPolicy } from '@/lib/reading/stt-policy';
import { DEFAULT_VAD, createSilenceDetector, type SilenceDetector, type VadEvent } from '@/lib/reading/vad';

/**
 * 플랫폼 STT(reading.session · reading.memorization). 기기 안 처리를 보장할 때만 켠다 — iOS 는
 * supportsOnDeviceRecognition, 안드로이드는 requiresOnDeviceRecognition 으로 오프라인 인식만 요청한다. 아니면
 * "입력하기"다. 결과 글은 대조에 쓰고 녹음 행의 전사로 남길 뿐 화면 밖으로 나가지 않는다.
 *
 * 인식기가 마이크를 열고 있는 동안은 녹음기와 다투지 않도록 인식기의 음량 이벤트로 침묵을 감지한다.
 */
const VOLUME_INTERVAL_MS = 50;

/** 인식기의 음량(-2~10, 0 아래는 들리지 않음)을 침묵 감지기가 아는 0~1 로. 실기기에서 맞춰 볼 근사값이다. */
export function sttVolumeToRms(value: number): number {
  return value > 0 ? Math.min(1, 0.015 + value * 0.05) : 0;
}

export async function detectSttPolicy(): Promise<SttPolicy> {
  try {
    const available = ExpoSpeechRecognitionModule.isRecognitionAvailable();
    const supportsOnDevice = ExpoSpeechRecognitionModule.supportsOnDeviceRecognition();
    let permission: 'granted' | 'denied' | 'undetermined' = 'undetermined';
    const current = await ExpoSpeechRecognitionModule.getPermissionsAsync();
    if (current.granted) permission = 'granted';
    else if (current.canAskAgain) permission = (await ExpoSpeechRecognitionModule.requestPermissionsAsync()).granted ? 'granted' : 'denied';
    else permission = 'denied';
    return sttPolicy({ available, supportsOnDevice, permission });
  } catch {
    return { kind: 'typing', reason: 'unavailable' };
  }
}

export type SttHandle = {
  /** 듣기 시작. 침묵 감지 사건과 중간 인식 결과를 알린다. */
  start: (callbacks: { onEvent: (event: VadEvent) => void; onInterim: (text: string) => void }) => boolean;
  /** 듣기를 끝내고 최종 글을 받는다. 못 알아들었으면 빈 글. */
  finish: () => Promise<string>;
  abort: () => void;
  interim: string;
};

export function useReadingStt(): SttHandle {
  const [interim, setInterim] = useState('');
  const text = useRef('');
  const active = useRef(false);
  const detector = useRef<SilenceDetector | null>(null);
  const callbacks = useRef<{ onEvent: (event: VadEvent) => void; onInterim: (text: string) => void } | null>(null);
  const settle = useRef<((text: string) => void) | null>(null);

  const finishNow = (value: string) => {
    active.current = false;
    detector.current = null;
    const resolve = settle.current;
    settle.current = null;
    resolve?.(value);
  };

  useSpeechRecognitionEvent('result', (event) => {
    if (!active.current) return;
    const transcript = event.results[0]?.transcript?.trim() ?? '';
    if (transcript) {
      text.current = transcript;
      setInterim(transcript);
      callbacks.current?.onInterim(transcript);
    }
    if (event.isFinal && settle.current) finishNow(text.current);
  });
  useSpeechRecognitionEvent('volumechange', (event) => {
    if (!active.current || !detector.current) return;
    const vad = detector.current.feed(sttVolumeToRms(event.value), Date.now());
    if (vad !== 'none') callbacks.current?.onEvent(vad);
  });
  useSpeechRecognitionEvent('end', () => {
    if (active.current || settle.current) finishNow(text.current);
  });
  useSpeechRecognitionEvent('error', () => {
    if (active.current || settle.current) finishNow(text.current);
  });

  const start = useCallback<SttHandle['start']>((next) => {
    text.current = '';
    setInterim('');
    callbacks.current = next;
    detector.current = createSilenceDetector(DEFAULT_VAD, Date.now());
    try {
      ExpoSpeechRecognitionModule.start({
        lang: speechLocale(),
        interimResults: true,
        continuous: true,
        requiresOnDeviceRecognition: true,
        volumeChangeEventOptions: { enabled: true, intervalMillis: VOLUME_INTERVAL_MS },
      });
      active.current = true;
      return true;
    } catch {
      active.current = false;
      return false;
    }
  }, []);

  const finish = useCallback((): Promise<string> => {
    if (!active.current) return Promise.resolve(text.current);
    return new Promise((resolve) => {
      settle.current = resolve;
      try {
        ExpoSpeechRecognitionModule.stop();
      } catch {
        finishNow(text.current);
      }
      // 인식기가 end 를 주지 않아도 여기서 멈춘다.
      setTimeout(() => {
        if (settle.current === resolve) finishNow(text.current);
      }, 2_500);
    });
  }, []);

  const abort = useCallback(() => {
    settle.current = null;
    active.current = false;
    detector.current = null;
    try {
      ExpoSpeechRecognitionModule.abort();
    } catch {}
  }, []);

  return { start, finish, abort, interim };
}
