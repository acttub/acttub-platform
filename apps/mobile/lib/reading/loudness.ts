/**
 * 리딩 소리 크기 맞추기(SOMA-664). 기기에서 만든 상대역 목소리(평균 약 -25dB)와 인식기가 남긴 내 녹음(평균 -30~-40dB)은
 * 고품질 목소리(약 -18dB)보다 작게 들렸다. 소리 전체의 세기(RMS)를 목표에 맞춰 키우되, 최고점이 -1dB 를 넘지 않게
 * 한다. 거의 무음(말이 없는 녹음)은 잡음만 커지므로 키우지 않는다. 줄이지는 않는다.
 */
const TARGET_RMS = 0.1; // -20 dBFS
const PEAK_CEILING = 0.891; // -1 dBFS
const SILENCE_RMS = 0.002; // -54 dBFS

export type LoudnessOptions = { maxGain: number };

function stats(samples: ArrayLike<number>): { rms: number; peak: number } {
  let sum = 0;
  let peak = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const v = samples[i];
    sum += v * v;
    const a = v < 0 ? -v : v;
    if (a > peak) peak = a;
  }
  return { rms: samples.length > 0 ? Math.sqrt(sum / samples.length) : 0, peak };
}

/** -1~1 소리에 곱할 배수. 1 이면 그대로다. */
export function loudnessGain(samples: ArrayLike<number>, options: LoudnessOptions): number {
  const { rms, peak } = stats(samples);
  if (rms < SILENCE_RMS || peak === 0) return 1;
  const gain = Math.min(options.maxGain, TARGET_RMS / rms, PEAK_CEILING / peak);
  return gain > 1 ? gain : 1;
}

export function normalizeFloatSamples(samples: Float32Array, options: LoudnessOptions): Float32Array {
  const gain = loudnessGain(samples, options);
  if (gain === 1) return samples;
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) out[i] = samples[i] * gain;
  return out;
}

function findDataChunk(bytes: Uint8Array): { offset: number; size: number } | null {
  if (bytes.length < 44) return null;
  const tag = (at: number) => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 12;
  let pcm16 = false;
  while (at + 8 <= bytes.length) {
    const id = tag(at);
    const size = view.getUint32(at + 4, true);
    if (id === 'fmt ') pcm16 = view.getUint16(at + 8, true) === 1 && view.getUint16(at + 22, true) === 16;
    if (id === 'data') return pcm16 ? { offset: at + 8, size: Math.min(size, bytes.length - at - 8) } : null;
    at += 8 + size + (size % 2);
  }
  return null;
}

/** 16비트 PCM WAV 의 소리 칸만 키운 새 바이트. WAV 가 아니거나 키울 게 없으면 받은 그대로 돌려준다. */
export function normalizeWavBytes(bytes: Uint8Array, options: LoudnessOptions): Uint8Array {
  const data = findDataChunk(bytes);
  if (!data) return bytes;
  const count = Math.floor(data.size / 2);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const samples = new Float32Array(count);
  for (let i = 0; i < count; i += 1) samples[i] = view.getInt16(data.offset + i * 2, true) / 32768;
  const gain = loudnessGain(samples, options);
  if (gain === 1) return bytes;
  const out = bytes.slice();
  const outView = new DataView(out.buffer, out.byteOffset, out.byteLength);
  for (let i = 0; i < count; i += 1) {
    const v = Math.round(samples[i] * gain * 32768);
    outView.setInt16(data.offset + i * 2, v > 32767 ? 32767 : v < -32768 ? -32768 : v, true);
  }
  return out;
}
