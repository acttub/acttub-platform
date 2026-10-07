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
 * prefetchIfWifi(): Wi-Fi 면 화면을 막지 않고 미리 받아 둔다(SOMA-494). ensureReady 와 같은 준비를 나눠 쓴다.
 * stop():           재생만 멈춘다. 만들던 것은 건드리지 않는다.
 *
 * 만들기와 재생을 나눈 이유는 미리 만들어 두기 위해서다 (SOMA-547) — 읽는 동안 다음 줄을
 * 만들어 두면 차례가 왔을 때 기다림이 없다.
 * 프리셋과 속도는 호출마다 지정하며, 미리 생성한 음성도 같은 설정으로 구분한다.
 */
import { File, Paths } from 'expo-file-system';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';

import { currentLanguage, translate as t } from '../../i18n.ts';
import { shouldStopCloudVoiceForSession } from '../cloud-voice.ts';

import { currentNetworkType } from '../network';
import { assetsPresent, downloadAssets, downloadVoiceStyle, MODEL_KINDS, type Variant } from './assets';
import type { VoiceProgress } from './download-progress.ts';
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
import { VoicePrepareError } from './voice-errors.ts';
import { readAppVoiceSupport } from '../voice-capability.ts';

export type ProgressFn = (progress: VoiceProgress) => void;

let tts: any = null;
let style: any = null;
/** 프리셋 id → 로드한 스타일. 기본 프리셋(cfg.preset)은 ensureReady 가 넣는다. */
const styles = new Map<string, any>();
let player: any = null;
let finishPlayback: (() => void) | null = null;
let playbackEpoch = 0;
let synthesisTail: Promise<unknown> = Promise.resolve();
let readyPromise: Promise<void> | null = null;
/** 준비를 지켜보는 화면들. 미리 받기가 먼저 시작했어도 나중에 온 화면이 진행을 받는다. */
const listeners = new Set<ProgressFn>();
let lastProgress: VoiceProgress | null = null;

function report(progress: VoiceProgress) {
  lastProgress = progress;
  for (const fn of [...listeners]) {
    try {
      fn(progress);
    } catch {}
  }
}
const cfg: {
  variant: Variant;
  preset: string;
  ep: 'xnnpack' | 'cpu' | 'nnapi';
  threads: number;
  steps: number;
  speed: number;
} = {
  variant: 'fp32', // 음질 우선
  preset: 'M1', // 기본 음성 프리셋
  ep: 'xnnpack', // 실행기
  threads: 4, // intra-op 스레드
  steps: 8, // 되돌리기 단계
  speed: 1.0, // 말속도
};

export function isReady(): boolean {
  return !!tts;
}

/** 모델·설정·음성 스타일을 1회 준비한다. 여러 번 불러도 실제 준비는 한 번만. */
export function ensureReady(onProgress: ProgressFn = () => {}): Promise<void> {
  if (tts) return Promise.resolve();
  listeners.add(onProgress);
  const detach = () => {
    listeners.delete(onProgress);
  };
  if (readyPromise) {
    if (lastProgress) onProgress(lastProgress);
    readyPromise.then(detach, detach);
    return readyPromise;
  }

  lastProgress = null;
  const work = (async () => {
    const assets = await downloadAssets(cfg.variant, cfg.preset, report);
    const options = {
      executionProviders: [cfg.ep],
      graphOptimizationLevel: 'all',
      intraOpNumThreads: Math.max(1, cfg.threads),
    };
    report({ phase: 'load', done: 0, total: MODEL_KINDS.length });
    const sessions: any = {};
    try {
      for (const [i, k] of MODEL_KINDS.entries()) {
        try {
          sessions[k] = await loadOnnx(assets.modelPaths[k], options);
        } catch (e: any) {
          sessions[k] = await loadOnnx(assets.modelPaths[k], { ...options, executionProviders: ['cpu'] });
        }
        report({ phase: 'load', done: i + 1, total: MODEL_KINDS.length });
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
    } catch (e) {
      throw new VoicePrepareError('model_load', 'model load failed', { cause: e });
    }
    await setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
    report({ phase: 'ready' });
  })();
  readyPromise = work.catch((e) => {
    if (readyPromise === guarded) readyPromise = null;
    throw e;
  });
  const guarded = readyPromise;
  guarded.then(detach, detach);
  return guarded;
}

/**
 * Wi-Fi 에서 모델을 미리 받아 둔다(배역 화면·대본 저장 뒤). 화면을 막지 않고 실패도 알리지 않는다 — 실패하면
 * 실행 화면이 평소처럼 받거나 묻는다. 이미 받아 뒀으면 아무것도 하지 않는다(메모리 로드는 쓸 때 한다).
 * 진행 중인 준비가 있으면 그것을 나눠 쓴다. 앱 목소리를 못 쓰는 기기(voice-capability)는 받지 않는다.
 */
export async function prefetchIfWifi(): Promise<void> {
  try {
    if (tts || readyPromise) return;
    if (assetsPresent(cfg.variant, cfg.preset)) return;
    if ((await readAppVoiceSupport()).unsupported) return;
    if ((await currentNetworkType()) !== 'wifi') return;
    if (tts || readyPromise) return;
    await ensureReady();
  } catch {}
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


/**
 * 프리셋의 스타일과 실제로 쓰게 된 프리셋. 처음이면 받아서 로드한다. 받지 못하면 기본 스타일로 읽고 그 사실을
 * 돌려준다 — 부르는 쪽이 대체 음성을 요청한 목소리의 저장본으로 남기지 않게 하려는 것이다.
 */
async function styleFor(preset?: string): Promise<{ voice: any; preset: string }> {
  const key = preset || cfg.preset;
  const cached = styles.get(key);
  if (cached) return { voice: cached, preset: key };
  try {
    const raw = await downloadVoiceStyle(cfg.variant, key);
    const loaded = loadVoiceStyleFromObjects([raw]);
    styles.set(key, loaded);
    return { voice: loaded, preset: key };
  } catch {
    return { voice: style, preset: cfg.preset };
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

  const wanted = new File(Paths.cache, speechScriptFileName(scriptId, keyFor(clean, preset, speed)));
  if (wanted.exists) return wanted.uri;

  const { voice, preset: used } = await styleFor(preset);
  // 요청한 목소리를 못 받아 기본 목소리로 읽었으면 기본 목소리의 열쇠로 남긴다. 요청한 열쇠로 남기면 나중에 그
  // 목소리를 받을 수 있게 돼도 저장본이 이미 있다며 계속 기본 목소리가 재생된다.
  const out = used === preset ? wanted : new File(Paths.cache, speechScriptFileName(scriptId, keyFor(clean, used, speed)));
  if (out.exists) return out.uri;
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
    // ended: 끝까지 재생돼 끝났다(재생기 사건). 아니면 stop() 이 끊은 것 — 그때는 stop() 이 바로 놓는다.
    const finish = (ended = false) => {
      subscription?.remove();
      if (finishPlayback === finish) finishPlayback = null;
      if (ended && player === current) {
        // 다 쓴 재생기는 바로 놓는다. 남겨 두면 다음 줄까지 상태 갱신이 계속 돌아 메모리가 찬다(0.1.2 안드로이드 OOM).
        // 사건 처리 도중에 놓지 않도록 한 박자 뒤에.
        player = null;
        setTimeout(() => {
          try {
            current.remove();
          } catch {}
        }, 0);
      }
      resolve();
    };
    finishPlayback = finish;
    subscription = current.addListener('playbackStatusUpdate', (status) => {
      if (status.didJustFinish) finish(true);
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
export function createQueueFor(scriptId: string, options: { cloud?: boolean; synthesizeCloud?: (text: string, scriptId: string, preset: string) => Promise<string> } = {}): SpeechQueueHandle {
  let cloudBlocked = false;
  const queue = createSpeechQueue({
    synthesize: async (text, _key, preset) => {
      if (options.cloud && options.synthesizeCloud && !cloudBlocked) {
        try {
          return await options.synthesizeCloud(text, scriptId, preset);
        } catch (error) {
          cloudBlocked = shouldStopCloudVoiceForSession(error as { status?: number });
          if (!isReady()) throw error;
        }
      }
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
  listeners.clear();
  lastProgress = null;
}
