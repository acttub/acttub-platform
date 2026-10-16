import { Paths } from 'expo-file-system';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { useCallback, useRef } from 'react';

import { speechLocale } from '@/lib/i18n';
import { READING_STT_IOS_CATEGORY } from '@/lib/reading/ios-audio';
import { restorePlaybackAudio } from '@/lib/reading/ios-audio-restore';
import { sttPolicy, type SttPolicy } from '@/lib/reading/stt-policy';
import { createRecordingTracker } from '@/lib/reading/stt-recordings';
import { DEFAULT_VAD, VAD_TICK_MS, createSilenceDetector, createVolumeFeed, type VadEvent } from '@/lib/reading/vad';

/**
 * 플랫폼 STT(reading.session · reading.memorization). 쓸 수 있고 권한이 있으면 켠다. 기기 안 인식만 요구하지 않는다 —
 * 기기 안 한국어 인식기가 소리를 받고도 결과를 주지 않아 리딩이 통째로 멈춘 일이 있었다(SOMA-741). 그래서 말소리는
 * OS 음성 인식 제공자가 처리할 수 있다. 결과 글은 대조에 쓰고 녹음 행의 전사로 남긴다.
 *
 * 인식기가 마이크를 열고 있는 동안은 녹음기와 다투지 않도록 인식기의 음량 이벤트로 침묵을 감지한다. 일반 인식기는 음량을
 * 주지 않기도 해서, 인식기가 알린 말 끝(speechend)도 침묵으로 친다.
 */
const VOLUME_INTERVAL_MS = 50;

/** 인식기의 음량(-2~10, 0 아래는 들리지 않음)을 침묵 감지기가 아는 0~1 로. 실기기에서 맞춰 볼 근사값이다. */
export function sttVolumeToRms(value: number): number {
  return value > 0 ? Math.min(1, 0.015 + value * 0.05) : 0;
}

export async function detectSttPolicy(): Promise<SttPolicy> {
  try {
    const available = ExpoSpeechRecognitionModule.isRecognitionAvailable();
    let permission: 'granted' | 'denied' | 'undetermined' = 'undetermined';
    const current = await ExpoSpeechRecognitionModule.getPermissionsAsync();
    if (current.granted) permission = 'granted';
    else if (current.canAskAgain) permission = (await ExpoSpeechRecognitionModule.requestPermissionsAsync()).granted ? 'granted' : 'denied';
    else permission = 'denied';
    return sttPolicy({ available, permission });
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
    restorePlaybackAudio();
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
  // 일반 인식기는 음량 이벤트를 주지 않기도 한다 — 인식기가 알린 말 시작·끝도 침묵 감지에 넘긴다(SOMA-741).
  // 받아쓴 글이 없는 말 끝(잡음)으로는 넘기지 않는다.
  useSpeechRecognitionEvent('speechstart', () => {
    if (active.current) callbacks.current?.onEvent('speech_start');
  });
  useSpeechRecognitionEvent('speechend', () => {
    if (!active.current || !text.current.trim()) return;
    callbacks.current?.onEvent('speech_end');
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
        requiresOnDeviceRecognition: false,
        volumeChangeEventOptions: { enabled: true, intervalMillis: VOLUME_INTERVAL_MS },
        // 기본(measurement)은 iOS 재생·녹음 소리를 크게 줄인다 — 일반 모드로 켠다(SOMA-710).
        iosCategory: READING_STT_IOS_CATEGORY,
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
    restorePlaybackAudio();
  }, [stopTicking]);

  const takeRecordingUri = useCallback((): string | null => recordings.discard(), [recordings]);

  const detachRecording = useCallback((): Promise<string | null> => recordings.detach(), [recordings]);

  const canPersist = useCallback(() => sttCanPersist(), []);

  return { start, finish, abort, takeRecordingUri, detachRecording, canPersist };
}
