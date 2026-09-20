import {
  RecordingPresets,
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
  useAudioRecorder,
} from 'expo-audio';
import { useCallback, useEffect, useRef } from 'react';

import { DEFAULT_VAD, createSilenceDetector, meteringToRms, type SilenceDetector, type VadEvent } from '@/lib/reading/vad';

/**
 * 내 차례의 마이크 — 녹음기의 미터링(dBFS)만 침묵 감지기에 넣는다(reading.session). 소리 자체는 이 훅
 * 밖으로 나가지 않는다. 녹음 파일은 stop() 이 돌려주므로 줄 단위 녹음(reading.recording)이 그대로 쓸 수 있다.
 */
const TICK_MS = 50;

export type MicHandle = {
  /** 마이크를 열고 침묵 감지를 시작한다. 권한이 없으면 false. */
  start: (onEvent: (event: VadEvent) => void, onLevel?: (rms: number) => void) => Promise<boolean>;
  /** 마이크를 닫는다. 녹음 파일 uri 와 길이(ms). 열려 있지 않았으면 null. */
  stop: () => Promise<{ uri: string | null; durationMs: number } | null>;
  listening: () => boolean;
};

export async function hasMicPermission(): Promise<boolean> {
  try {
    const current = await getRecordingPermissionsAsync();
    if (current.granted) return true;
    if (!current.canAskAgain) return false;
    return (await requestRecordingPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

export function useReadingMic(): MicHandle {
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const detector = useRef<SilenceDetector | null>(null);
  const active = useRef(false);

  const stop = useCallback(async (): Promise<{ uri: string | null; durationMs: number } | null> => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    detector.current = null;
    if (!active.current) return null;
    active.current = false;
    let durationMs = 0;
    try {
      durationMs = recorder.getStatus().durationMillis ?? 0;
    } catch {
      durationMs = 0;
    }
    try {
      await recorder.stop();
      return { uri: recorder.uri ?? null, durationMs };
    } catch {
      return { uri: null, durationMs };
    }
  }, [recorder]);

  const start = useCallback(
    async (onEvent: (event: VadEvent) => void, onLevel?: (rms: number) => void): Promise<boolean> => {
      if (active.current) await stop();
      try {
        const perm = await getRecordingPermissionsAsync();
        if (!perm.granted) return false;
        await recorder.prepareToRecordAsync({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
        recorder.record();
      } catch {
        return false;
      }
      active.current = true;
      detector.current = createSilenceDetector(DEFAULT_VAD, Date.now());
      timer.current = setInterval(() => {
        if (!active.current || !detector.current) return;
        let rms = 0;
        try {
          rms = meteringToRms(recorder.getStatus().metering);
        } catch {
          rms = 0;
        }
        onLevel?.(rms);
        const event = detector.current.feed(rms, Date.now());
        if (event !== 'none') onEvent(event);
      }, TICK_MS);
      return true;
    },
    [recorder, stop],
  );

  useEffect(
    () => () => {
      void stop();
    },
    [stop],
  );

  return { start, stop, listening: () => active.current };
}
