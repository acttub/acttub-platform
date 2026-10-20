/**
 * fp16 가중치를 fp32 로 늘린다(SOMA-747).
 *
 * 리딩 목소리 모델을 fp16 으로 받아 받는 양을 절반으로 줄이고, 폰에서 한 번 fp32 로 풀어 저장한다. 실행되는
 * 모델은 지금(fp32)과 같은 형태라 실행기(XNNPACK)·속도·메모리가 그대로다.
 *
 * Hermes 에는 Float16Array 가 없어서 65,536칸 표로 비트를 바로 바꾼다(한 번만 만든다).
 */

/** 한 번에 읽어 늘리는 크기(바이트). fp16 값이 조각 경계에서 갈리지 않게 짝수다. */
export const FP16_UNPACK_CHUNK = 4 * 1024 * 1024;

let table: Uint32Array | null = null;

function halfBitsToFloatBits(h: number): number {
  const sign = (h & 0x8000) << 16;
  const exp = (h >> 10) & 0x1f;
  let mant = h & 0x3ff;
  if (exp === 0) {
    if (mant === 0) return sign; // ±0
    // subnormal → 정규화
    let e = -1;
    do {
      e++;
      mant <<= 1;
    } while ((mant & 0x400) === 0);
    mant &= 0x3ff;
    return (sign | ((127 - 15 - e) << 23) | (mant << 13)) >>> 0;
  }
  if (exp === 0x1f) return (sign | 0x7f800000 | (mant << 13)) >>> 0; // 무한·NaN
  return (sign | ((exp - 15 + 127) << 23) | (mant << 13)) >>> 0;
}

function lookup(): Uint32Array {
  if (table) return table;
  const t = new Uint32Array(65536);
  for (let h = 0; h < 65536; h++) t[h] = halfBitsToFloatBits(h);
  table = t;
  return t;
}

/** little-endian fp16 바이트를 little-endian fp32 바이트로. 길이는 정확히 두 배가 된다. */
export function halfToFloatBytes(src: Uint8Array): Uint8Array {
  if (src.byteLength % 2 !== 0) throw new Error('fp16 bytes must have even length');
  const t = lookup();
  const n = src.byteLength >> 1;
  const halves =
    src.byteOffset % 2 === 0 ? new Uint16Array(src.buffer, src.byteOffset, n) : new Uint16Array(src.slice().buffer, 0, n);
  const out = new Uint32Array(n);
  for (let i = 0; i < n; i++) out[i] = t[halves[i]];
  return new Uint8Array(out.buffer);
}
