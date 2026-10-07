/**
 * 음량(RMS) 기반 침묵 감지(reading.session). 웹 `audio/vad.ts` 와 같은 규칙·상수다. 오디오 데이터는 이
 * 함수 밖으로 나가지 않는다 — 숫자 하나(RMS)만 받아서 "말 시작 / 말 끝 / 시간 초과"만 돌려준다.
 *
 * 앱은 expo-audio 녹음기의 미터링(dBFS)을 RMS 로 바꿔 넣는다(meteringToRms).
 */

export interface VadOptions {
  /** 0~1. 이 이상이면 소리가 난다고 본다 */
  threshold: number;
  /** 이만큼 조용하면 말이 끝난 것으로 본다 (ms) */
  silenceMs: number;
  /** 이보다 짧은 소리는 소음으로 무시한다 (ms) */
  minSpeechMs: number;
  /** 아무 말도 없이 이만큼 지나면 timeout (ms) — 넘기지 않고 안내만 한다 */
  maxListenMs: number;
}

export type VadEvent = 'none' | 'speech_start' | 'speech_end' | 'timeout';

export interface SilenceDetector {
  feed(rms: number, now: number): VadEvent;
}

/** 웹 현행 상수를 앱에도 그대로(확정 결정 7). */
export const DEFAULT_VAD: VadOptions = {
  threshold: 0.015,
  silenceMs: 1800, // 연기는 대사 중간에 사이가 길어서 여유 있게
  minSpeechMs: 400,
  maxListenMs: 60000,
};

export function createSilenceDetector(opts: VadOptions, startedAt: number): SilenceDetector {
  let listenStart = startedAt;
  let speaking = false;
  let speechStart = 0;
  let lastLoud = 0;

  return {
    feed(rms, now) {
      const loud = rms >= opts.threshold;
      if (!speaking) {
        if (loud) {
          speaking = true;
          speechStart = now;
          lastLoud = now;
          return 'speech_start';
        }
        if (now - listenStart >= opts.maxListenMs) {
          listenStart = now;
          return 'timeout';
        }
        return 'none';
      }
      if (loud) {
        lastLoud = now;
        return 'none';
      }
      if (now - lastLoud < opts.silenceMs) return 'none';
      speaking = false;
      const spoke = lastLoud - speechStart >= opts.minSpeechMs;
      if (!spoke) {
        listenStart = now; // 소음이었다 — 대기 시간을 다시 잰다
        return 'none';
      }
      return 'speech_end';
    },
  };
}

/** 인식기 음량을 다시 넣는 간격(ms). */
export const VAD_TICK_MS = 100;

/**
 * 음량이 띄엄띄엄 오는 입력(플랫폼 인식기)용. 안드로이드 인식기는 조용해지면 음량 사건을 보내지 않아, 다음 사건이
 * 올 때까지 침묵을 재지 못해 넘김이 수 초 늦었다(SOMA-631). volume 으로 받은 마지막 값을 tick 마다 다시 넣는다.
 */
export function createVolumeFeed(detector: SilenceDetector, emit: (event: VadEvent) => void, now: () => number = Date.now) {
  let last = 0;
  const push = () => {
    const event = detector.feed(last, now());
    if (event !== 'none') emit(event);
  };
  return {
    volume(rms: number) {
      last = rms;
      push();
    },
    tick: push,
  };
}

/** 녹음기 미터링(dBFS, 0 이 최대)을 0~1 진폭으로. 값이 없으면 0(조용함). */
export function meteringToRms(db: number | undefined | null): number {
  if (typeof db !== 'number' || Number.isNaN(db)) return 0;
  if (db >= 0) return 1;
  return 10 ** (db / 20);
}
