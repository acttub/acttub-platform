/* eslint-disable */
// @ts-nocheck
/**
 * 대본 리딩용 온디바이스 음성 엔진 (SOMA-527).
 * 스파이크(SOMA-500)에서 검증한 다운로드→로드→합성 흐름을 재사용 가능한 싱글턴으로 묶었다.
 *
 * ensureReady(): 모델 4개 + 설정 + 기본 음성 스타일을 1회 준비(다운로드 캐시 + ORT 세션 로드).
 * speak(text, preset): 한 문장을 그 프리셋(M1~M5·F1~F5)으로 합성해 재생하고, 재생이 끝나면 resolve 한다.
 *               프리셋 스타일은 처음 쓸 때 받아 메모리에 둔다 — 배역마다 다른 목소리로 읽는다(reading.cast).
 * preview(preset): 짧은 예문을 그 프리셋으로 들려준다(배역 화면의 미리 듣기).
 * stop():       현재 재생 중지.
 */
import { File, Paths } from 'expo-file-system';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';

import { currentLanguage, translate as t } from '../../i18n.ts';

import { downloadAssets, downloadVoiceStyle, MODEL_KINDS, type Variant } from './assets';
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
/** 프리셋 id → 로드한 스타일. 기본 프리셋(cfg.preset)은 ensureReady 가 넣는다. */
const styles = new Map<string, any>();
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
    onProgress(t('reading.voiceLoading'));
    const sessions: any = {};
    for (const k of MODEL_KINDS) {
      try {
        sessions[k] = await loadOnnx(assets.modelPaths[k], options);
      } catch (e: any) {
        sessions[k] = await loadOnnx(assets.modelPaths[k], { ...options, executionProviders: ['cpu'] });
      }
    }
    style = loadVoiceStyleFromObjects([assets.style]);
    styles.set(cfg.preset, style);
    tts = new TextToSpeech(
      assets.cfgs,
      new UnicodeProcessor(assets.indexer),
      sessions.durationPredictor,
      sessions.textEncoder,
      sessions.vectorEstimator,
      sessions.vocoder,
    );
    await setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
    onProgress(t('reading.voiceReady'));
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
/** 프리셋의 스타일. 처음이면 받아서 로드한다. 모르는 프리셋은 기본 스타일로 읽는다. */
async function styleFor(preset?: string): Promise<any> {
  const key = preset || cfg.preset;
  const cached = styles.get(key);
  if (cached) return cached;
  try {
    const raw = await downloadVoiceStyle(cfg.variant, key);
    const loaded = loadVoiceStyleFromObjects([raw]);
    styles.set(key, loaded);
    return loaded;
  } catch {
    return style;
  }
}

export async function speak(text: string, preset?: string): Promise<void> {
  if (!tts) throw new Error(t('reading.voiceNotReady'));
  const clean = (text ?? '').trim();
  if (!clean) return;

  const voice = await styleFor(preset);
  // 모델은 32개 말을 읽을 줄 안다. 대본이 어느 말로 쓰였는지는 알 수 없으니
  // 앱을 쓰는 말로 읽힌다 — 한국어 사용자는 지금과 같다 (SOMA-544).
  const { wav, duration } = await tts.call(clean, currentLanguage(), voice, cfg.steps, cfg.speed, 0.1);
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

/** 배역 화면의 미리 듣기 — 짧은 예문을 그 프리셋으로. */
export function preview(preset: string): Promise<void> {
  const sample = currentLanguage() === 'ko' ? '안녕하세요, 이 목소리로 읽어 드릴게요.' : 'Hello, I will read the lines in this voice.';
  return speak(sample, preset);
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
  styles.clear();
  readyPromise = null;
}
