import { Paths } from 'expo-file-system';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { useCallback, useRef } from 'react';

import { speechLocale } from '@/lib/i18n';
import { sttPolicy, type SttPolicy } from '@/lib/reading/stt-policy';
import { createRecordingTracker } from '@/lib/reading/stt-recordings';
import { DEFAULT_VAD, VAD_TICK_MS, createSilenceDetector, createVolumeFeed, type VadEvent } from '@/lib/reading/vad';

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
  /**
   * 듣기 시작. 침묵 감지 사건과 중간 인식 결과를 알린다. persist 면 인식기가 들은 소리를 파일로 남긴다 —
   * 녹음이 켜진 회차의 내 차례 녹음 파일이다(녹음기를 따로 열지 않는다, 조정자 결정).
   */
  start: (callbacks: { onEvent: (event: VadEvent) => void; onInterim: (text: string) => void }, options?: { persist?: boolean }) => boolean;
  /** 듣기를 끝내고 최종 글을 받는다. 못 알아들었으면 빈 글. */
  finish: () => Promise<string>;
  abort: () => void;
  /** 끝나지 않고 닫힌 듣기의 조각 파일 uri(persist 였을 때). 지울 때만 쓴다 — 아직 덜 써졌을 수 있다. */
  takeRecordingUri: () => string | null;
  /**
   * finish 뒤 이 줄의 녹음을 떼어 낸다(동기로 불러야 다음 줄과 섞이지 않는다). 인식기는 audioend 뒤에야 파일을
   * 다 쓰므로 그때(최대 1.5초) 파일 uri 로 끝나고, 없으면 null. 기다리는 동안 다음 줄로 넘어가도 된다(SOMA-631).
   */
  detachRecording: () => Promise<string | null>;
  /** 이 기기에서 인식기가 들은 소리를 파일로 남길 수 있는가(Android 13+·iOS). */
  canPersist: () => boolean;
};

/** 인식기 녹음 지원 여부. 안 되는 기기에서 persist 를 켜면 소리 없는 파일이 남는다. */
export function sttCanPersist(): boolean {
  try {
    return ExpoSpeechRecognitionModule.supportsRecording();
  } catch {
    return false;
  }
}

export function useReadingStt(): SttHandle {
  const text = useRef('');
  const active = useRef(false);
  const volumeFeed = useRef<ReturnType<typeof createVolumeFeed> | null>(null);
  const ticker = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopTicking = useCallback(() => {
    if (ticker.current) clearInterval(ticker.current);
    ticker.current = null;
    volumeFeed.current = null;
  }, []);
  const callbacks = useRef<{ onEvent: (event: VadEvent) => void; onInterim: (text: string) => void } | null>(null);
  const settle = useRef<((text: string) => void) | null>(null);
  const recordings = useRef(createRecordingTracker()).current;

  const finishNow = useCallback((value: string) => {
    active.current = false;
    stopTicking();
    const resolve = settle.current;
    settle.current = null;
    resolve?.(value);
  }, [stopTicking]);

  useSpeechRecognitionEvent('result', (event) => {
    if (!active.current) return;
    const transcript = event.results[0]?.transcript?.trim() ?? '';
    if (transcript) {
      text.current = transcript;
      callbacks.current?.onInterim(transcript);
    }
    if (event.isFinal && settle.current) finishNow(text.current);
  });
  useSpeechRecognitionEvent('volumechange', (event) => {
    if (!active.current) return;
    volumeFeed.current?.volume(sttVolumeToRms(event.value));
  });
  useSpeechRecognitionEvent('audioend', (event) => {
    recordings.audioEnd(event?.uri);
  });
  useSpeechRecognitionEvent('end', () => {
    if (active.current || settle.current) finishNow(text.current);
  });
  useSpeechRecognitionEvent('error', () => {
    if (active.current || settle.current) finishNow(text.current);
  });

  const start = useCallback<SttHandle['start']>((next, options) => {
    text.current = '';
    const persist = !!options?.persist && sttCanPersist();
    recordings.begin(persist);
    callbacks.current = next;
    stopTicking();
    volumeFeed.current = createVolumeFeed(createSilenceDetector(DEFAULT_VAD, Date.now()), (vad) => callbacks.current?.onEvent(vad));
    ticker.current = setInterval(() => volumeFeed.current?.tick(), VAD_TICK_MS);
    try {
      ExpoSpeechRecognitionModule.start({
        lang: speechLocale(),
        interimResults: true,
        continuous: true,
        requiresOnDeviceRecognition: true,
        volumeChangeEventOptions: { enabled: true, intervalMillis: VOLUME_INTERVAL_MS },
        ...(persist
          ? { recordingOptions: { persist: true, outputDirectory: Paths.cache.uri, outputFileName: `reading-line-${Date.now()}.wav` } }
          : {}),
      });
      active.current = true;
      return true;
    } catch {
      active.current = false;
      stopTicking();
      recordings.discard();
      return false;
    }
  }, [recordings, stopTicking]);

  const finish = useCallback((): Promise<string> => {
    if (!active.current) return Promise.resolve(text.current);
    return new Promise((resolve) => {
      settle.current = resolve;
      recordings.stopping();
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
  }, [finishNow, recordings]);

  const abort = useCallback(() => {
    // 이미 finish 로 멈춘 듣기는 끊지 않는다 — 떼어 낸 녹음 파일을 인식기가 마저 쓰는 중일 수 있다.
    const listening = active.current || settle.current !== null;
    settle.current = null;
    active.current = false;
    stopTicking();
    if (!listening) return;
    try {
      ExpoSpeechRecognitionModule.abort();
    } catch {}
  }, [stopTicking]);

  const takeRecordingUri = useCallback((): string | null => recordings.discard(), [recordings]);

  const detachRecording = useCallback((): Promise<string | null> => recordings.detach(), [recordings]);

  const canPersist = useCallback(() => sttCanPersist(), []);

  return { start, finish, abort, takeRecordingUri, detachRecording, canPersist };
}
