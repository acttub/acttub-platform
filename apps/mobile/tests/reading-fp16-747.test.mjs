import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { halfToFloatBytes, FP16_UNPACK_CHUNK } from '../lib/reading/tts/half-float.ts';

const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

/** fp16 비트 하나를 little-endian 2바이트로. */
const half = (...bits) => new Uint8Array(new Uint16Array(bits).buffer);
const floats = (bytes) => Array.from(new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4));

test('fp16 가중치를 fp32 로 늘린다 — 보통 수·0·음수(SOMA-747)', () => {
  // 1.0 = 0x3C00, -2.0 = 0xC000, 0.5 = 0x3800, 0 = 0x0000, -0 = 0x8000, 65504(최대) = 0x7BFF
  const out = halfToFloatBytes(half(0x3c00, 0xc000, 0x3800, 0x0000, 0x8000, 0x7bff));
  assert.equal(out.byteLength, 24);
  const f = floats(out);
  assert.deepEqual(f.slice(0, 4), [1, -2, 0.5, 0]);
  assert.ok(Object.is(f[4], -0));
  assert.equal(f[5], 65504);
});

test('아주 작은 수(subnormal)·무한·NaN 도 그대로 옮긴다', () => {
  // 가장 작은 subnormal 0x0001 = 2^-24, 무한 0x7C00, -무한 0xFC00, NaN 0x7E00
  const f = floats(halfToFloatBytes(half(0x0001, 0x03ff, 0x7c00, 0xfc00, 0x7e00)));
  assert.equal(f[0], 2 ** -24);
  assert.equal(f[1], 1023 * 2 ** -24);
  assert.equal(f[2], Infinity);
  assert.equal(f[3], -Infinity);
  assert.ok(Number.isNaN(f[4]));
});

test('조각 크기는 짝수 바이트여서 fp16 값이 조각 경계에서 갈리지 않는다', () => {
  assert.equal(FP16_UNPACK_CHUNK % 2, 0);
  assert.throws(() => halfToFloatBytes(new Uint8Array(3)), /even/);
});

test('fp16 묶음은 그래프를 받아 두고 가중치를 폰에서 fp32 로 풀어 쓴다', () => {
  const assets = src('lib/reading/tts/assets.ts');
  assert.match(assets, /\.graph\.onnx/);
  assert.match(assets, /\.weights\.f16/);
  assert.match(assets, /\.weights\.f32/);
  assert.match(assets, /halfToFloatBytes\(/);
  // 받을 곳이 정해지지 않았으면 지금처럼 fp32 를 받는다.
  assert.match(assets, /export function fp16Available\(\)/);
  const engine = src('lib/reading/tts/engine.ts');
  assert.match(engine, /downloadAssets\(activeVariant\(\)/);
  assert.match(assets, /if \(assetsPresent\('fp32', 'M1'\)\) return 'fp32';/);
});
