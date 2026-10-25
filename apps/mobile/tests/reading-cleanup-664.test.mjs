import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { loudnessGain, normalizeFloatSamples, normalizeWavBytes } from '../lib/reading/loudness.ts';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const db = (x) => 20 * Math.log10(x);

function tone(amplitude, length = 16000, gapRatio = 0) {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i += 1) out[i] = i < length * gapRatio ? 0 : amplitude * Math.sin(i / 7);
  return out;
}

test('작은 소리는 키우되 최고점은 -1dB 를 넘기지 않고, 이미 큰 소리는 그대로다', () => {
  const quiet = tone(0.05);
  const gain = loudnessGain(quiet, { maxGain: 8 });
  assert.ok(gain > 2, `gain ${gain}`);
  const out = normalizeFloatSamples(quiet, { maxGain: 8 });
  const peak = Math.max(...out.map(Math.abs));
  assert.ok(db(peak) <= -1 + 1e-6, `peak ${db(peak)}`);
  assert.equal(loudnessGain(tone(0.95), { maxGain: 8 }), 1);
});

test('키우는 폭은 정한 최대까지만이고, 거의 무음(잡음)은 키우지 않는다', () => {
  assert.equal(loudnessGain(tone(0.01), { maxGain: 4 }), 4);
  assert.equal(loudnessGain(tone(0.001), { maxGain: 4 }), 1);
  assert.equal(loudnessGain(new Float32Array(100), { maxGain: 4 }), 1);
});

test('WAV(16비트) 녹음은 data 칸만 키우고 머리(44바이트)는 그대로다', () => {
  const samples = 1600;
  const bytes = new Uint8Array(44 + samples * 2);
  const view = new DataView(bytes.buffer);
  bytes.set([...'RIFF'].map((c) => c.charCodeAt(0)), 0);
  view.setUint32(4, 36 + samples * 2, true);
  bytes.set([...'WAVEfmt '].map((c) => c.charCodeAt(0)), 8);
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  bytes.set([...'data'].map((c) => c.charCodeAt(0)), 36);
  view.setUint32(40, samples * 2, true);
  for (let i = 0; i < samples; i += 1) view.setInt16(44 + i * 2, Math.round(1500 * Math.sin(i / 5)), true);
  const header = bytes.slice(0, 44);
  const out = normalizeWavBytes(bytes, { maxGain: 8 });
  assert.deepEqual(out.slice(0, 44), header);
  const outView = new DataView(out.buffer, out.byteOffset);
  let peak = 0;
  for (let i = 0; i < samples; i += 1) peak = Math.max(peak, Math.abs(outView.getInt16(44 + i * 2, true)));
  // 세기(RMS)를 -20dB 쯤으로 맞춘다 — 이 소리는 약 3배가 된다
  assert.ok(peak > 1500 * 2.5, `peak ${peak}`);
  assert.ok(peak <= 32767 * 0.892, `peak ${peak}`);
  // WAV 가 아니면 손대지 않는다
  const junk = new Uint8Array([1, 2, 3, 4]);
  assert.equal(normalizeWavBytes(junk, { maxGain: 8 }), junk);
});

test('기기 목소리는 만든 직후, 내 녹음은 올리기 전에 음량을 맞춘다', () => {
  assert.match(read('lib/reading/tts/engine.ts'), /normalizeFloatSamples\(Float32Array\.from\(wav\)/);
  assert.match(read('lib/reading/recording-runner.ts'), /normalizeRecordingFile\(/);
});

test('대본 탭 위에 고품질 목소리 켜기 줄이 있고 설정에서는 빠졌다', () => {
  const tab = read('app/(tabs)/reading.tsx');
  assert.match(tab, /useCloudVoice\(\)/);
  assert.match(tab, /cloudVoice\.consentSheet/);
  assert.match(tab, /cloudVoice\.bannerLabel/);
  assert.doesNotMatch(read('app/settings.tsx'), /useCloudVoice|cloudVoice\.settingsTitle/);
});

test('대본 파일을 올리는 중·나누는 중에는 화면을 떠날 수 없다', () => {
  const screen = read('app/reading/new.tsx');
  assert.match(screen, /const working = input\.file\.kind === 'reading' \|\| popup\?\.kind === 'splitting';/);
  assert.match(screen, /usePreventRemove\(working,/);
  assert.match(screen, /gestureEnabled: !working/);
});

test('연습 기록에서 빼는 동작은 「삭제」라고 부른다(영상은 보관함에 남는다)', () => {
  const ko = read('locales/ko.ts');
  assert.match(ko, /hideConfirm: '삭제',/);
  assert.match(ko, /hideTitle: '이 연습을 기록에서 삭제할까요\?',/);
  assert.doesNotMatch(ko, /hideConfirm: '숨기기'/);
});
