/**
 * 음량(RMS) 기반 침묵 감지. 오디오 데이터는 이 함수 밖으로 나가지 않는다 —
 * 숫자 하나(RMS)만 받아서 "말 시작 / 말 끝 / 시간 초과"만 돌려준다.
 */

export interface VadOptions {
  /** 0~1. 이 이상이면 소리가 난다고 본다 */
  threshold: number;
  /** 이만큼 조용하면 말이 끝난 것으로 본다 (ms) */
  silenceMs: number;
  /** 이보다 짧은 소리는 소음으로 무시한다 (ms) */
  minSpeechMs: number;
  /** 아무 말도 없이 이만큼 지나면 timeout (ms) */
  maxListenMs: number;
}

export type VadEvent = "none" | "speech_start" | "speech_end" | "timeout";

export interface SilenceDetector {
  feed(rms: number, now: number): VadEvent;
  reset(now: number): void;
  speaking(): boolean;
}

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
          return "speech_start";
        }
        if (now - listenStart >= opts.maxListenMs) {
          listenStart = now;
          return "timeout";
        }
        return "none";
      }
      if (loud) {
        lastLoud = now;
        return "none";
      }
      if (now - lastLoud < opts.silenceMs) return "none";
      speaking = false;
      const spoke = lastLoud - speechStart >= opts.minSpeechMs;
      if (!spoke) {
        listenStart = now; // 소음이었다 — 대기 시간을 다시 잰다
        return "none";
      }
      return "speech_end";
    },
    reset(now) {
      listenStart = now;
      speaking = false;
      speechStart = 0;
      lastLoud = 0;
    },
    speaking: () => speaking,
  };
}

/** AnalyserNode 시간영역 샘플(-1~1 float)의 RMS */
export function rmsOf(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / (samples.length || 1));
}
