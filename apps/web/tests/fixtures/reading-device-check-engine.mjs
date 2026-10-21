// device-check 화면이 쓰는 음성 엔진·재생 대역. 테스트가 정한 값을 돌려주고 부른 것을 남긴다.
export const engine = {
  size: 380 * 1024 * 1024,
  cached: false,
  backend: "webgpu",
  variant: "fp32",
  duration: 2.5,
  loadError: null,
  synthesized: [],
  played: [],
  unlocked: 0,
  onLoad: null,
  loadGate: null,
  /** performance.now 대역이 읽는 시각(ms). 준비가 끝나면 loadMs, 두 번째 합성이 끝나면 genMs 만큼 흐른다. */
  now: 0,
  loadMs: 0,
  genMs: 0,
};

export const downloadSize = async () => engine.size;
export const hasCachedModels = async () => engine.cached;
export async function load(onProgress) {
  engine.onLoad?.(onProgress);
  if (engine.loadGate) await engine.loadGate;
  if (engine.loadError) throw engine.loadError;
  engine.now += engine.loadMs;
  return { backend: engine.backend, variant: engine.variant };
}
export const currentBackend = () => engine.backend;
export const currentVariant = () => engine.variant;
export async function synthesize(text, preset, options) {
  engine.synthesized.push({ text, preset, options });
  if (engine.synthesized.length === 2) engine.now += engine.genMs;
  return { samples: new Float32Array(1), sampleRate: 24000, duration: engine.duration };
}
export const unlockAudio = () => {
  engine.unlocked += 1;
};
export async function playSynthesized(audio) {
  engine.played.push(audio.duration);
}
