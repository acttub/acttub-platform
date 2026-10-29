import {
  RecordingPresets,
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
  useAudioRecorder,
} from 'expo-audio';
import { useCallback, useEffect, useRef } from 'react';
import { Platform } from 'react-native';

import { createSilenceDetector, currentVad, meteringToRms, type SilenceDetector, type VadEvent } from '@/lib/reading/vad';

/**
 * 내 차례의 마이크 — 녹음기의 미터링(dBFS)만 침묵 감지기에 넣는다(reading.session). 소리 자체는 이 훅
 * 밖으로 나가지 않는다. 녹음 파일은 stop() 이 돌려주므로 줄 단위 녹음(reading.recording)이 그대로 쓸 수 있다.
 */
const TICK_MS = 50;

export type MicHandle = {
  /** 마이크를 열고 침묵 감지를 시작한다. 권한이 없으면 false. */
  start: (onEvent: (event: VadEvent) => void) => Promise<boolean>;
  /** 마이크를 닫는다. 녹음 파일 uri 와 길이(ms). 열려 있지 않았으면 null. */
  stop: () => Promise<{ uri: string | null; durationMs: number } | null>;
};

/**
 * 권한이 없으면 OS 팝업으로 묻는다. 조회의 canAskAgain 만 보고 묻지 않으면 안 된다 — 안드로이드에서 「이번만 허용」이 끝난
 * 뒤에는 조회가 canAskAgain=false 를 주지만 실제로 물으면 OS 창이 다시 뜬다(10/28 폰 확인). 정말 막혔으면 요청이 창 없이
 * 바로 거절로 돌아온다.
 */
export async function hasMicPermission(): Promise<boolean> {
  try {
    const current = await getRecordingPermissionsAsync();
    if (current.granted) return true;
    return (await requestRecordingPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

/** 묻지 않고 지금 권한만 본다. */
export async function micPermissionGranted(): Promise<boolean> {
  try {
    return (await getRecordingPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

/** 마이크 권한 상태 — ask 는 OS 창으로 물을 수 있음, blocked 는 다시 물을 수 없어 설정에서 켜야 함. */
export type MicPermission = 'granted' | 'ask' | 'blocked';

/** 묻지 않고 지금 상태만 본다(SOMA-772). */
export async function micPermissionState(): Promise<MicPermission> {
  try {
    const current = await getRecordingPermissionsAsync();
    if (current.granted) return 'granted';
    // 안드로이드의 조회 canAskAgain 은 「이번만 허용」이 끝난 뒤에도 false 라 믿지 않는다 — 시작 버튼에서 실제로 물어 본다.
    if (Platform.OS === 'android') return 'ask';
    return current.canAskAgain ? 'ask' : 'blocked';
  } catch {
    return 'ask';
  }
}

/**
 * 연습 시작 버튼에서 부른다(SOMA-772) — 물을 수 있으면 OS 창을 띄운다. denied 는 방금 거절(다음에 또 물을 수 있음),
 * blocked 는 다시 물을 수 없어 설정으로 보내야 한다.
 */
export async function requestMicPermission(): Promise<'granted' | 'denied' | 'blocked'> {
  try {
    const current = await getRecordingPermissionsAsync();
    if (current.granted) return 'granted';
    // 조회가 다시 못 묻는다고 해도 한 번은 요청한다(위 hasMicPermission 설명). 막혔으면 창 없이 blocked 로 돌아온다.
    const asked = await requestRecordingPermissionsAsync();
    if (asked.granted) return 'granted';
    return asked.canAskAgain ? 'denied' : 'blocked';
  } catch {
    return 'denied';
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
    async (onEvent: (event: VadEvent) => void): Promise<boolean> => {
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
      detector.current = createSilenceDetector(currentVad(), Date.now());
      timer.current = setInterval(() => {
        if (!active.current || !detector.current) return;
        let rms = 0;
        try {
          rms = meteringToRms(recorder.getStatus().metering);
        } catch {
          rms = 0;
        }
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

  return { start, stop };
}
