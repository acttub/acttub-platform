/* eslint-disable */
// @ts-nocheck
/**
 * 대본 리딩용 온디바이스 음성 엔진 (SOMA-527).
 * 스파이크(SOMA-500)에서 검증한 다운로드→로드→합성 흐름을 재사용 가능한 싱글턴으로 묶었다.
 *
 * ensureReady(): 모델 4개 + 설정 + 음성 스타일을 1회 준비(다운로드 캐시 + ORT 세션 로드).
 * speak(text):  한 문장을 합성해 재생하고, 재생이 끝나면 resolve 한다(리딩 루프가 자동으로 다음 줄로).
 * stop():       현재 재생 중지.
 */
import { File, Paths } from 'expo-file-system';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';

import { downloadAssets, MODEL_KINDS, type Variant } from './assets';
import {
  loadOnnx,
  loadVoiceStyleFromObjects,
  TextToSpeech,
  UnicodeProcessor,
  writeWavFile,
} from './helper.native.js';
import { speechFileName } from './speech-file';

export interface EngineConfig {
  variant?: Variant; // 기본 fp32(음질 우선)
  preset?: string; // 음성 프리셋, 기본 M1
  ep?: 'xnnpack' | 'cpu' | 'nnapi'; // 실행기, 기본 xnnpack
  threads?: number; // intra-op 스레드, 기본 4
  steps?: number; // 되돌리기 단계, 기본 8
  speed?: number; // 말속도, 기본 1.0
}

export type ProgressFn = (line: string) => void;

let tts: any = null;
let style: any = null;
let player: any = null;
let readyPromise: Promise<void> | null = null;
let cfg: Required<EngineConfig> = {
  variant: 'fp32',
  preset: 'M1',
  ep: 'xnnpack',
  threads: 4,
  steps: 8,
  speed: 1.0,
};

export function isReady(): boolean {
  return !!tts;
}

export function configure(next: EngineConfig) {
  cfg = { ...cfg, ...next };
}

/** 모델·설정·음성 스타일을 1회 준비한다. 여러 번 불러도 실제 준비는 한 번만. */
export function ensureReady(onProgress: ProgressFn = () => {}, next?: EngineConfig): Promise<void> {
  if (next) configure(next);
  if (tts) return Promise.resolve();
  if (readyPromise) return readyPromise;

  readyPromise = (async () => {
    const assets = await downloadAssets(cfg.variant, cfg.preset, onProgress);
    const options = {
      executionProviders: [cfg.ep],
      graphOptimizationLevel: 'all',
      intraOpNumThreads: Math.max(1, cfg.threads),
    };
    onProgress('음성 모델 로드 중...');
    const sessions: any = {};
    for (const k of MODEL_KINDS) {
      try {
        sessions[k] = await loadOnnx(assets.modelPaths[k], options);
      } catch (e: any) {
        sessions[k] = await loadOnnx(assets.modelPaths[k], { ...options, executionProviders: ['cpu'] });
      }
    }
    style = loadVoiceStyleFromObjects([assets.style]);
    tts = new TextToSpeech(
      assets.cfgs,
      new UnicodeProcessor(assets.indexer),
      sessions.durationPredictor,
      sessions.textEncoder,
      sessions.vectorEstimator,
      sessions.vocoder,
    );
    await setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
    onProgress('준비 완료');
  })().catch((e) => {
    readyPromise = null;
    throw e;
  });

  return readyPromise;
}

/**
 * 한 문장을 합성해 재생한다. 재생이 끝날 즈음(합성이 알려준 길이 + 여유) resolve.
 * 이미 읽을 수 없게 정리된(빈) 문장이면 아무 것도 하지 않고 즉시 resolve.
 */
export async function speak(text: string): Promise<void> {
  if (!tts) throw new Error('음성 엔진이 준비되지 않았어요');
  const clean = (text ?? '').trim();
  if (!clean) return;

  const { wav, duration } = await tts.call(clean, 'ko', style, cfg.steps, cfg.speed, 0.1);
  const durSec = duration[0] || 0;
  const samples = Float32Array.from(wav);
  const bytes = writeWavFile(samples, tts.sampleRate);
  const out = new File(Paths.cache, speechFileName(Date.now()));
  out.write(bytes);

  stop();
  player = createAudioPlayer({ uri: out.uri });
  player.play();

  await new Promise<void>((resolve) => {
    setTimeout(resolve, Math.max(300, durSec * 1000 + 200));
  });
}

export function stop() {
  try {
    player?.remove?.();
  } catch {}
  player = null;
}

/** 테스트/재진입용 초기화. */
export function _reset() {
  stop();
  tts = null;
  style = null;
  readyPromise = null;
}
