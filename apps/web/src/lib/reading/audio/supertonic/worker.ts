/// <reference lib="webworker" />
/**
 * 음성 합성은 여기서 돈다.
 *
 * 메인 스레드에서 돌리면 한 대사에 1~2초씩 화면이 통째로 멈춘다 — 브라우저가
 * "응답 없음"을 띄울 만큼이다. 리허설 중에는 진행 표시도 멈춤 버튼도 살아 있어야
 * 하므로 추론을 통째로 이 워커로 옮겼다.
 */
import * as ort from "onnxruntime-web";
import { loadOnnx, loadVoiceStyle, UnicodeProcessor, TextToSpeech, type VoiceStyleTensors } from "./helper.js";
import { fetchModel } from "@/lib/reading/audio/supertonic/cache";
import {
  CONFIG_URL,
  INDEXER_URL,
  MODEL_KINDS,
  MODEL_VARIANTS,
  variantBytes,
  voiceStyleUrl,
  type ModelKind,
  type Variant,
  type VoicePreset,
} from "@/lib/reading/audio/supertonic/models";

export type Backend = "webgpu" | "wasm";

export type ToWorker =
  | { id: number; type: "load"; prefer?: Backend }
  | { id: number; type: "synth"; text: string; preset: VoicePreset; speed: number; steps: number; gapSec: number };

export type FromWorker =
  | { id: number; type: "progress"; ratio: number; loaded: number; total: number; cached: boolean }
  | { id: number; type: "loaded"; backend: Backend; variant: Variant }
  | { id: number; type: "audio"; samples: Float32Array; sampleRate: number; duration: number }
  | { id: number; type: "error"; message: string };

const post = (m: FromWorker, transfer?: Transferable[]) =>
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(m, transfer ?? []);

/**
 * 긴 대사는 문장 단위로 나뉘어 따로 합성된 뒤 이어 붙는다. 그 사이에 넣는 무음.
 *
 * 원래 값은 0.3초인데 대사 한가운데에 완전한 무음이 그만큼 들어가면 끊긴 것으로
 * 들린다. 각 조각은 이미 문장 끝의 여운을 달고 끝나므로 여기서는 조금만 준다.
 */
const GAP_SEC = 0.1;

let tts: TextToSpeech | null = null;
let ready: Promise<void> | null = null;
const styles = new Map<VoicePreset, VoiceStyleTensors>();

/**
 * 어느 장치로 돌릴지 먼저 정한다. 가중치를 받기 전에 알아야 하는데,
 * int8 은 WebGPU 에서 진폭이 터져 못 쓰기 때문이다(models.ts 참고).
 */
async function pickBackend(prefer?: Backend): Promise<Backend> {
  if (prefer) return prefer;
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (!gpu) return "wasm";
  try {
    return (await gpu.requestAdapter()) ? "webgpu" : "wasm";
  } catch {
    return "wasm";
  }
}

// 가중치는 실행 장치와 무관하게 fp32(380MB)다. int8(138MB)은 폰에서 들어 보니 목소리가 뭉개져
// 쓸 만하지 않았다(2026-08-27). 용량보다 소리가 먼저다. int8 정의는 남겨 두되 고르지 않는다.
const variantFor = (): Variant => "fp32";

async function doLoad(id: number, prefer?: Backend): Promise<void> {
  ort.env.wasm.wasmPaths = "/ort/";
  // 교차 출처 격리(COOP/COEP, next.config.ts headers)가 켜져 있으면 SharedArrayBuffer 가 있어
  // wasm 을 여러 스레드로 돌릴 수 있다. 폰에서 스레드 1개는 RTF 2.5 라 끊긴다.
  // 격리가 안 된 환경(격리 미지원 브라우저 등)에서는 1개로 떨어진다.
  const isolated = typeof SharedArrayBuffer !== "undefined" && (self as unknown as { crossOriginIsolated?: boolean }).crossOriginIsolated === true;
  const cores = typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 2 : 2;
  ort.env.wasm.numThreads = isolated ? Math.max(1, Math.min(4, cores - 1)) : 1;

  const backend = await pickBackend(prefer);
  const variant = variantFor();
  const { urls, bytes: sizes } = MODEL_VARIANTS[variant];
  const total = variantBytes(variant);

  const seen: Record<string, number> = {};
  let allCached = true;
  const report = () => {
    const done = Object.values(seen).reduce((a, b) => a + b, 0);
    post({ id, type: "progress", ratio: Math.min(1, done / total), loaded: done, total, cached: allCached });
  };

  const parts = await Promise.all(
    MODEL_KINDS.map(async (k) => {
      const buf = await fetchModel(urls[k], sizes[k], (p) => {
        if (!p.cached) allCached = false;
        seen[k] = p.loaded;
        report();
      });
      return [k, buf] as const;
    }),
  );
  const bytes = Object.fromEntries(parts) as Record<ModelKind, Uint8Array>;

  const [cfgs, indexer] = await Promise.all([
    fetch(CONFIG_URL).then((r) => r.json()),
    fetch(INDEXER_URL).then((r) => r.json()),
  ]);

  const sessions = [];
  for (const k of MODEL_KINDS) {
    sessions.push(await loadOnnx(bytes[k], { executionProviders: [backend] }));
  }
  const [dp, textEnc, vectorEst, vocoder] = sessions;
  tts = new TextToSpeech(cfgs, new UnicodeProcessor(indexer), dp, textEnc, vectorEst, vocoder);

  // WebGPU 는 첫 합성에서 셰이더를 컴파일하느라 3초 넘게 걸린다. 미리 데워 둔다.
  try {
    await synth("음", "F1", 1.0, 8);
  } catch {
    // 데우기가 실패해도 첫 대사가 조금 늦어질 뿐이다.
  }

  post({ id, type: "loaded", backend, variant });
}

async function styleFor(preset: VoicePreset): Promise<VoiceStyleTensors> {
  const hit = styles.get(preset);
  if (hit) return hit;
  const s = await loadVoiceStyle([voiceStyleUrl(preset)]);
  styles.set(preset, s);
  return s;
}

async function synth(text: string, preset: VoicePreset, speed: number, steps: number, gapSec = GAP_SEC) {
  if (!tts) throw new Error("음성 엔진이 준비되지 않았다");
  const style = await styleFor(preset);
  const { wav, duration } = await tts.call(text, "ko", style, steps, speed, gapSec);
  const len = Math.min(wav.length, Math.floor(tts.sampleRate * duration[0]));
  // helper 가 배열을 돌려주기도 해서 여기서 확실히 Float32Array 로 만든다.
  const samples = Float32Array.from(wav.slice(0, len));
  return { samples, sampleRate: tts.sampleRate, duration: duration[0] };
}

/** 요청은 한 줄로 세운다. 동시에 두 개를 돌리면 서로 느려지기만 한다. */
let queue: Promise<unknown> = Promise.resolve();
const enqueue = <T,>(fn: () => Promise<T>): Promise<T> => {
  const next = queue.then(fn, fn);
  queue = next.catch(() => {});
  return next;
};

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const msg = e.data;
  void enqueue(async () => {
    try {
      if (msg.type === "load") {
        ready ??= doLoad(msg.id, msg.prefer);
        await ready;
        return;
      }
      const audio = await synth(msg.text, msg.preset, msg.speed, msg.steps, msg.gapSec);
      // 버퍼를 넘겨주면 복사가 없다.
      post({ id: msg.id, type: "audio", ...audio }, [audio.samples.buffer]);
    } catch (err) {
      if (msg.type === "load") ready = null;
      post({ id: msg.id, type: "error", message: err instanceof Error ? err.message : String(err) });
    }
  });
};
