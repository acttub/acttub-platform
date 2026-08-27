/**
 * Supertonic 3 모델 자산의 출처.
 *
 * ⚠ 2026-08-27: 기본 가중치는 장치와 무관하게 **fp32(380MB)** 다. 아래 int8 설명은 그 전의 결정이고,
 * int8 은 폰에서 들어 보니 목소리가 뭉개져 쓰지 않는다(worker.ts variantFor). 정의만 남겨 둔다.
 *
 *
 * 큰 가중치는 int8 양자화본(합계 약 138MB)을 쓴다 — fp32 380MB 대비 64% 작고,
 * 귀로 구분되는 열화가 없었다. 발음을 담당하는 text_encoder / duration_predictor 는
 * 양자화 대상이 아니라 fp32 그대로라, 줄어든 건 음색 쪽 정밀도뿐이다.
 *
 * 파일은 저장소에 넣지 않고 HuggingFace CDN 에서 직접 받는다. CORS 가 열려 있고
 * range 요청도 되므로 우리 쪽 호스팅 비용이 0이다. 받은 뒤에는 Cache API 에 넣어
 * 두 번째 실행부터는 네트워크를 타지 않는다.
 */

/** 양자화된 가중치 — sherpa-onnx 가 재패키징한 것. tts.json 이 원본과 동일해 런타임 호환된다. */
const INT8 = "https://huggingface.co/csukuangfj2/sherpa-onnx-supertonic-3-tts-int8-2026-05-11/resolve/main";
/** 설정·문자 인덱서·보이스 프리셋 — 원본 저장소. 전부 합쳐 400KB 남짓이라 양자화와 무관하다. */
const BASE = "https://huggingface.co/Supertone/supertonic-3/resolve/main";

export type ModelKind = "durationPredictor" | "textEncoder" | "vectorEstimator" | "vocoder";

/**
 * 가중치는 두 벌이다.
 *
 * int8 은 작지만 **WebGPU 에서 쓸 수 없다** — onnxruntime 의 WebGPU 백엔드가 양자화
 * 연산을 제대로 처리하지 못해 진폭이 수천만 배로 터진 잡음이 나온다. 측정값:
 * int8+webgpu 는 rms 21,863,463 / peak 96,648,832, 정상은 rms 0.056 / peak 0.327.
 * 같은 int8 을 wasm 으로 돌리면 rms 0.0561 로 정상이라 런타임 쪽 한계가 맞다.
 *
 * 그래서 실행 장치에 따라 가중치를 고른다. WebGPU 면 fp32, wasm 이면 int8.
 */
export const MODEL_VARIANTS = {
  fp32: {
    urls: {
      durationPredictor: `${BASE}/onnx/duration_predictor.onnx`,
      textEncoder: `${BASE}/onnx/text_encoder.onnx`,
      vectorEstimator: `${BASE}/onnx/vector_estimator.onnx`,
      vocoder: `${BASE}/onnx/vocoder.onnx`,
    },
    bytes: {
      durationPredictor: 3_700_147,
      textEncoder: 36_416_150,
      vectorEstimator: 256_534_781,
      vocoder: 101_424_195,
    },
  },
  int8: {
    urls: {
      durationPredictor: `${INT8}/duration_predictor.int8.onnx`,
      textEncoder: `${INT8}/text_encoder.int8.onnx`,
      vectorEstimator: `${INT8}/vector_estimator.int8.onnx`,
      vocoder: `${INT8}/vocoder.int8.onnx`,
    },
    bytes: {
      durationPredictor: 3_700_147,
      textEncoder: 36_416_150,
      vectorEstimator: 78_400_833,
      vocoder: 25_991_073,
    },
  },
} as const satisfies Record<string, { urls: Record<ModelKind, string>; bytes: Record<ModelKind, number> }>;

export type Variant = keyof typeof MODEL_VARIANTS;

export const MODEL_KINDS: readonly ModelKind[] = [
  "durationPredictor",
  "textEncoder",
  "vectorEstimator",
  "vocoder",
];

export function variantBytes(v: Variant): number {
  return Object.values(MODEL_VARIANTS[v].bytes).reduce((a, b) => a + b, 0);
}

export const CONFIG_URL = `${BASE}/onnx/tts.json`;
export const INDEXER_URL = `${BASE}/onnx/unicode_indexer.json`;

/** 프리셋 목소리. M=남성, F=여성. 배역마다 하나씩 배정한다. */
export const VOICE_PRESETS = ["M1", "M2", "M3", "M4", "M5", "F1", "F2", "F3", "F4", "F5"] as const;
export type VoicePreset = (typeof VOICE_PRESETS)[number];

export const voiceStyleUrl = (preset: VoicePreset) => `${BASE}/voice_styles/${preset}.json`;

/** 모델 가중치는 OpenRAIL-M 이다. 배포물에 이 고지를 노출해야 한다. */
export const MODEL_ATTRIBUTION = {
  name: "Supertonic 3",
  author: "Supertone Inc.",
  license: "OpenRAIL-M",
  url: "https://huggingface.co/Supertone/supertonic-3",
} as const;
