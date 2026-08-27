/**
 * Supertonic 음성 엔진의 창구. 실제 추론은 워커에서 돈다(worker.ts).
 *
 * 모델은 브라우저 안에서 돌아간다 — 대본이 네트워크로 나가지 않는다는 원칙은 그대로다.
 */
import { isCached } from "@/lib/reading/audio/supertonic/cache";
import { MODEL_VARIANTS, variantBytes, type Variant, type VoicePreset } from "@/lib/reading/audio/supertonic/models";
import type { Backend, FromWorker, ToWorker } from "@/lib/reading/audio/supertonic/worker";

export type { Backend };

export interface LoadProgress {
  /** 0~1 */
  ratio: number;
  loaded: number;
  total: number;
  /** 전부 캐시에서 나왔으면 true — 진행률 UI 를 띄울 필요가 없다 */
  cached: boolean;
}

export interface Synthesized {
  samples: Float32Array;
  sampleRate: number;
  /** 초 */
  duration: number;
}

export interface SynthOptions {
  /** 0.9~1.5 사이가 쓸 만하다. 기본 1.0 */
  speed?: number;
  /** 되돌리기 단계. 높을수록 좋고 느리다. 기본 8 */
  steps?: number;
  /** 긴 대사가 나뉠 때 조각 사이에 넣는 무음(초). 기본 0.1 */
  gapSec?: number;
}

let worker: Worker | null = null;
let seq = 0;
let loading: Promise<{ backend: Backend; variant: Variant }> | null = null;
let info: { backend: Backend; variant: Variant } | null = null;

type Pending = {
  resolve: (v: never) => void;
  reject: (e: Error) => void;
  onProgress?: (p: LoadProgress) => void;
};
const pending = new Map<number, Pending>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (e: MessageEvent<FromWorker>) => {
    const m = e.data;
    const p = pending.get(m.id);
    if (!p) return;
    if (m.type === "progress") {
      p.onProgress?.({ ratio: m.ratio, loaded: m.loaded, total: m.total, cached: m.cached });
      return;
    }
    pending.delete(m.id);
    if (m.type === "error") p.reject(new Error(m.message));
    else if (m.type === "loaded") (p.resolve as (v: unknown) => void)({ backend: m.backend, variant: m.variant });
    else (p.resolve as (v: unknown) => void)({ samples: m.samples, sampleRate: m.sampleRate, duration: m.duration });
  };
  return worker;
}

/** 유니온에 Omit 을 그냥 쓰면 갈래별로 나뉘지 않아 공통 필드만 남는다. 갈래마다 벗겨 낸다. */
type WithoutId<T> = T extends { id: number } ? Omit<T, "id"> : never;

function send<T>(msg: WithoutId<ToWorker>, onProgress?: (p: LoadProgress) => void): Promise<T> {
  const id = ++seq;
  const w = getWorker();
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as Pending["resolve"], reject, onProgress });
    w.postMessage({ ...msg, id } as ToWorker);
  });
}

/** 모델을 받아 워커를 준비시킨다. 여러 번 불러도 실제 작업은 한 번만 한다. */
export function load(onProgress?: (p: LoadProgress) => void, prefer?: Backend) {
  if (info) return Promise.resolve(info);
  loading ??= send<{ backend: Backend; variant: Variant }>({ type: "load", prefer }, onProgress)
    .then((got) => {
      info = got;
      return got;
    })
    .catch((e) => {
      // 실패한 시도를 붙잡고 있으면 재시도가 영영 같은 오류를 받는다.
      loading = null;
      throw e;
    });
  return loading;
}

/**
 * 만들어 둔 소리를 다시 쓰기 위한 곳.
 *
 * 미리 만들어 두는 의미가 여기에 있다 — 캐시가 없으면 prefetch 가 한 일을
 * speak 이 그대로 다시 해서 작업량만 두 배가 된다.
 * 대본 한 편이 수백 줄이므로 최근 것만 남긴다.
 */
const MAX_CACHED = 24;
const audioCache = new Map<string, Promise<Synthesized>>();
const keyOf = (text: string, preset: VoicePreset, o: SynthOptions) =>
  `${preset}|${o.speed ?? 1.0}|${o.steps ?? 8}|${o.gapSec ?? 0.1}|${text}`;

/** 대사 한 줄을 소리로 만든다. 같은 대사를 다시 청하면 만들어 둔 것을 준다. */
export function synthesize(text: string, preset: VoicePreset, opts: SynthOptions = {}): Promise<Synthesized> {
  const key = keyOf(text, preset, opts);
  const hit = audioCache.get(key);
  if (hit) {
    // 최근 것으로 올려 둔다 — 다시 쓰인 것은 곧 또 쓰일 만하다.
    audioCache.delete(key);
    audioCache.set(key, hit);
    return hit;
  }

  const made = load()
    .then(() =>
      send<Synthesized>({
        type: "synth",
        text,
        preset,
        speed: opts.speed ?? 1.0,
        steps: opts.steps ?? 8,
        gapSec: opts.gapSec ?? 0.1,
      }),
    )
    .catch((e) => {
      // 실패한 것을 남겨 두면 다시 시도해도 같은 실패만 돌려준다.
      audioCache.delete(key);
      throw e;
    });

  audioCache.set(key, made);
  while (audioCache.size > MAX_CACHED) {
    const oldest = audioCache.keys().next().value;
    if (oldest === undefined) break;
    audioCache.delete(oldest);
  }
  return made;
}

/** 이 기기가 받게 될 가중치가 이미 캐시에 있는지 — 다운로드 안내를 띄울지 정할 때 쓴다. */
export async function hasCachedModels(): Promise<boolean> {
  const v = await guessVariant();
  return isCached(Object.values(MODEL_VARIANTS[v].urls));
}

/** 이 기기가 받아야 할 용량. 안내 문구에 쓴다. */
export async function downloadSize(): Promise<number> {
  return variantBytes(await guessVariant());
}

/** 워커를 깨우지 않고도 어느 가중치를 쓸지 알아야 안내 문구를 그릴 수 있다. */
async function guessVariant(): Promise<Variant> {
  if (info) return info.variant;
  // 장치와 무관하게 fp32 다 (worker.ts variantFor 와 같은 결정).
  return "fp32";
}

export function currentBackend(): Backend | null {
  return info?.backend ?? null;
}

export function currentVariant(): Variant | null {
  return info?.variant ?? null;
}

/** 테스트에서 상태를 되돌리기 위한 것. */
export function _reset() {
  worker?.terminate();
  worker = null;
  info = null;
  loading = null;
  pending.clear();
  audioCache.clear();
}
