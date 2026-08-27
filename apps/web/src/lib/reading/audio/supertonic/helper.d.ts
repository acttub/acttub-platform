/**
 * 벤더링한 helper.js 의 타입 선언. 원본은 순수 자바스크립트라 우리가 쓰는 표면만 적는다.
 */
import type { InferenceSession } from "onnxruntime-web";

/** 보이스 프리셋을 텐서로 펼쳐 담은 것. 내부 구조는 우리가 들여다볼 일이 없다. */
export type VoiceStyleTensors = { readonly __brand: "SupertonicStyle" };

export class UnicodeProcessor {
  constructor(indexer: unknown);
}

export class TextToSpeech {
  constructor(
    cfgs: unknown,
    textProcessor: UnicodeProcessor,
    dpOrt: InferenceSession,
    textEncOrt: InferenceSession,
    vectorEstOrt: InferenceSession,
    vocoderOrt: InferenceSession,
  );
  readonly sampleRate: number;
  call(
    text: string,
    lang: string,
    style: VoiceStyleTensors,
    totalStep: number,
    speed?: number,
    silenceDuration?: number,
    progressCallback?: ((done: number, total: number) => void) | null,
  ): Promise<{ wav: Float32Array; duration: number[] }>;
}

export function loadOnnx(
  source: string | Uint8Array,
  options?: InferenceSession.SessionOptions,
): Promise<InferenceSession>;

export function loadVoiceStyle(voiceStylePaths: string[], verbose?: boolean): Promise<VoiceStyleTensors>;

/** 샘플을 WAV 바이트로 만든다. 브라우저판은 ArrayBuffer 를 돌려준다. */
export function writeWavFile(audioData: ArrayLike<number>, sampleRate: number): ArrayBuffer;

export const AVAILABLE_LANGS: readonly string[];
export function isValidLang(lang: string): boolean;
