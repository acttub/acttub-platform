/* eslint-disable */
// @ts-nocheck
/**
 * 대본 리딩용 온디바이스 음성 엔진 (SOMA-527).
 * 스파이크(SOMA-500)에서 검증한 다운로드→로드→합성 흐름을 재사용 가능한 싱글턴으로 묶었다.
 *
 * ensureReady():   모델 4개 + 설정 + 음성 스타일을 1회 준비(다운로드 캐시 + ORT 세션 로드).
 * synthesize(text): 한 문장을 만들어 파일로 남기고 그 자리를 돌려준다. 소리는 내지 않는다.
 * play(uri):        만들어 둔 파일을 틀고, 끝날 즈음 resolve 한다.
 * speak(text):      위 둘을 이어서 한다(만들어 둔 것이 없을 때 쓰는 길).
 * stop():           재생만 멈춘다. 만들던 것은 건드리지 않는다.
 *
 * 만들기와 재생을 나눈 이유는 미리 만들어 두기 위해서다 (SOMA-547) — 읽는 동안 다음 줄을
 * 만들어 두면 차례가 왔을 때 기다림이 없다.
 * 프리셋과 속도는 호출마다 지정하며, 미리 생성한 음성도 같은 설정으로 구분한다.
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
import { speechScriptFileName } from './speech-file.ts';
import { speechKey } from './speech-key.ts';
import { createSpeechQueue, type SpeechQueue } from './prefetch.ts';

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
let finishPlayback: (() => void) | null = null;
let playbackEpoch = 0;
let synthesisTail: Promise<unknown> = Promise.resolve();
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

/** 지금 설정으로 이 문장이 갖게 될 열쇠. 파일 이름과 캐시가 이것으로 갈린다. */
export function keyFor(text: string, preset = cfg.preset, speed = cfg.speed): string {
  return speechKey({
    text,
    locale: currentLanguage(),
    preset,
    variant: cfg.variant,
    steps: cfg.steps,
    speed,
  });
}

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

/** 미리 생성과 화면의 즉시 요청도 같은 엔진을 한 번에 하나만 사용한다. */
export function synthesize(text: string, scriptId: string, preset = cfg.preset, options: { speed?: number } = {}): Promise<string | null> {
  const work = synthesisTail.then(() => synthesizeOne(text, scriptId, preset, options.speed ?? cfg.speed));
  synthesisTail = work.catch(() => undefined);
  return work;
}

async function synthesizeOne(text: string, scriptId: string, preset: string, speed: number): Promise<string | null> {
  if (!tts) throw new Error(t('reading.voiceNotReady'));
  const clean = (text ?? '').trim();
  if (!clean) return null;

  const out = new File(Paths.cache, speechScriptFileName(scriptId, keyFor(clean, preset, speed)));
  if (out.exists) return out.uri;

  const voice = await styleFor(preset);
  // 모델은 32개 말을 읽을 줄 안다. 대본이 어느 말로 쓰였는지는 알 수 없으니
  // 앱을 쓰는 말로 읽힌다 — 한국어 사용자는 지금과 같다 (SOMA-544).
  // 말속도는 호출마다 바꿀 수 있다(듣고 따라 하기의 천천히 0.7×).
  const { wav } = await tts.call(clean, currentLanguage(), voice, cfg.steps, speed, 0.1);
  const samples = Float32Array.from(wav);
  out.write(writeWavFile(samples, tts.sampleRate));
  return out.uri;
}

/** 저장본의 길이가 아직 0이어도 실제 재생 완료를 기다린다(Expo SDK 54 playbackStatusUpdate). */
export async function play(uri: string): Promise<void> {
  stop();
  const current = createAudioPlayer({ uri });
  player = current;
  await new Promise<void>((resolve, reject) => {
    let subscription: { remove(): void } | null = null;
    const finish = () => {
      subscription?.remove();
      if (finishPlayback === finish) finishPlayback = null;
      resolve();
    };
    finishPlayback = finish;
    subscription = current.addListener('playbackStatusUpdate', (status) => {
      if (status.didJustFinish) finish();
    });
    try {
      current.play();
    } catch (error) {
      subscription.remove();
      if (finishPlayback === finish) finishPlayback = null;
      reject(error);
    }
  });
}

/** 만들어 둔 것이 없을 때 — 만들고 바로 튼다. */
export async function speak(text: string, preset = cfg.preset, options: { speed?: number; scriptId?: string } = {}): Promise<void> {
  stop();
  const epoch = playbackEpoch;
  const uri = await synthesize(text, options.scriptId ?? 'adhoc', preset, options);
  if (uri && epoch === playbackEpoch) await play(uri);
}

export type SpeechQueueHandle = SpeechQueue & {
  /** 첫 줄만 만들어 둘 때까지 기다린다 — 읽기 시작 화면에서 쓴다. */
  first: () => Promise<void>;
};

/**
 * 이 대본의 미리 만들기 큐. 만드는 일은 엔진이 하고, 순서와 취소는 큐가 본다 (SOMA-547).
 */
export function createQueueFor(scriptId: string): SpeechQueueHandle {
  const queue = createSpeechQueue({
    synthesize: async (text, _key, preset) => {
      const uri = await synthesize(text, scriptId, preset);
      if (!uri) throw new Error('빈 문장');
      return uri;
    },
    scriptId,
    locale: currentLanguage(),
    preset: cfg.preset,
    variant: cfg.variant,
    steps: cfg.steps,
    speed: cfg.speed,
  });
  return { ...queue, first: () => queue.settled() };
}

/** 배역 화면의 미리 듣기 — 짧은 예문을 그 프리셋으로. */
export function preview(preset: string): Promise<void> {
  const sample = currentLanguage() === 'ko' ? '안녕하세요, 이 목소리로 읽어 드릴게요.' : 'Hello, I will read the lines in this voice.';
  return speak(sample, preset);
}

export function stop() {
  playbackEpoch += 1;
  finishPlayback?.();
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
