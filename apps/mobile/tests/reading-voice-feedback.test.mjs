import assert from 'node:assert/strict';
import test from 'node:test';

import {
  analyzeVoice,
  decodeWav,
  envelopeFromSamples,
  pitchTrack,
  syllableCount,
} from '../lib/reading/voice-feedback.ts';

const SR = 16000;

function tone(seconds, hz, amp = 0.3, sr = SR) {
  const out = new Float32Array(Math.round(seconds * sr));
  for (let i = 0; i < out.length; i += 1) out[i] = amp * Math.sin((2 * Math.PI * hz * i) / sr);
  return out;
}
function silence(seconds, amp = 0.001, sr = SR) {
  const out = new Float32Array(Math.round(seconds * sr));
  for (let i = 0; i < out.length; i += 1) out[i] = amp * Math.sin(i * 1.3);
  return out;
}
function concat(...parts) {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}
/** 말하는 것처럼 음절마다 켜졌다 꺼지는 소리. */
function syllables(n, perSecond, hz = 200, amp = 0.3) {
  const parts = [];
  for (let i = 0; i < n; i += 1) parts.push(tone(0.7 / perSecond, hz + (i % 5) * 25, amp), silence(0.3 / perSecond, amp / 30));
  return concat(...parts);
}
function wavInt16(samples, sr = SR) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, samples.length * 2, true);
  samples.forEach((x, i) => v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, x)) * 32767, true));
  return new Uint8Array(buf);
}

test('voice-feedback: wav(16bit) 를 표본으로 풀고, 소리 없는 머리만 있는 파일은 null', () => {
  const decoded = decodeWav(wavInt16(tone(0.5, 220)));
  assert.equal(decoded.sampleRate, SR);
  assert.equal(decoded.samples.length, 8000);
  assert.ok(Math.abs(Math.max(...decoded.samples.slice(0, 200)) - 0.3) < 0.02);
  assert.equal(decodeWav(wavInt16(new Float32Array(0))), null);
  assert.equal(decodeWav(new Uint8Array([1, 2, 3])), null);
});

test('voice-feedback: 한국어 음절 수는 한글 글자 수', () => {
  assert.equal(syllableCount('여기 있을 줄 알았어.'), 8);
  assert.equal(syllableCount('...'), 0);
});

test('voice-feedback: 음높이를 따라간다 — 200Hz 소리는 200Hz 근처', () => {
  const hz = pitchTrack(tone(0.5, 200), SR, 20).filter((x) => x > 0);
  assert.ok(hz.length > 10);
  const median = hz.sort((a, b) => a - b)[Math.floor(hz.length / 2)];
  assert.ok(Math.abs(median - 200) < 10, `median ${median}`);
});

test('voice-feedback: 또렷하고 적당한 속도의 대사는 칩이 없다', () => {
  const text = '달라지지 나는 알잖아 네가 그거 얼마나 준비했는지'; // 20음절
  const s = concat(silence(0.3), syllables(20, 4.5), silence(0.3));
  const result = analyzeVoice({ envelopeDb: envelopeFromSamples(s, SR, 20), frameMs: 20, text, pitchHz: pitchTrack(s, SR, 20) });
  assert.deepEqual(result.chips, [], JSON.stringify(result.metrics));
  assert.ok(result.metrics.sps > 3.5 && result.metrics.sps < 6, String(result.metrics.sps));
});

test('voice-feedback: 주변 소리에 비해 목소리가 작으면 quiet', () => {
  // 목소리(0.03)와 계속 깔린 주변 소리(0.01)의 차이가 10dB 안팎.
  const voice = concat(silence(0.3, 0), syllables(12, 4.5, 200, 0.03), silence(0.3, 0));
  let seed = 7;
  const s = voice.map((x) => { seed = (seed * 16807) % 2147483647; return x + 0.01 * ((seed / 2147483647) * 2 - 1) * 1.7; });
  const r = analyzeVoice({ envelopeDb: envelopeFromSamples(s, SR, 20), frameMs: 20, text: '가나다라마바사아자차카타' });
  assert.ok(r.chips.includes('quiet'), JSON.stringify(r.metrics));
});

test('voice-feedback: 끝이 흐려지면 end_drop, 2초보다 짧은 대사는 보지 않는다', () => {
  const body = syllables(16, 4.5);
  const faded = body.map((x, i) => (i > body.length * 0.8 ? x * 0.12 : x));
  const r = analyzeVoice({ envelopeDb: envelopeFromSamples(concat(silence(0.2), faded, silence(0.2)), SR, 20), frameMs: 20, text: '가'.repeat(16) });
  assert.ok(r.chips.includes('end_drop'), JSON.stringify(r.metrics));
  const short = syllables(5, 4.5).map((x, i, a) => (i > a.length * 0.8 ? x * 0.1 : x));
  const s = analyzeVoice({ envelopeDb: envelopeFromSamples(short, SR, 20), frameMs: 20, text: '가'.repeat(5) });
  assert.equal(s.metrics.endDropDb, null);
});

test('voice-feedback: 너무 빠르거나 느리면 fast/slow', () => {
  const fast = analyzeVoice({ envelopeDb: envelopeFromSamples(syllables(20, 9), SR, 20), frameMs: 20, text: '가'.repeat(20) });
  assert.ok(fast.chips.includes('fast'), JSON.stringify(fast.metrics));
  const slow = analyzeVoice({ envelopeDb: envelopeFromSamples(syllables(8, 1.6), SR, 20), frameMs: 20, text: '가'.repeat(8) });
  assert.ok(slow.chips.includes('slow'), JSON.stringify(slow.metrics));
});

test('voice-feedback: 음높이가 거의 안 바뀌면 flat', () => {
  const s = tone(3, 180);
  const env = envelopeFromSamples(concat(silence(0.2), s, silence(0.2)), SR, 20);
  const r = analyzeVoice({ envelopeDb: env, frameMs: 20, text: '가'.repeat(13), pitchHz: pitchTrack(concat(silence(0.2), s, silence(0.2)), SR, 20) });
  assert.ok(r.chips.includes('flat'), JSON.stringify(r.metrics));
});

test('voice-feedback: 대사 중간에 오래 쉬면 pauses', () => {
  const s = concat(syllables(8, 4.5), silence(1.2), syllables(8, 4.5));
  const r = analyzeVoice({ envelopeDb: envelopeFromSamples(s, SR, 20), frameMs: 20, text: '가'.repeat(16) });
  assert.ok(r.chips.includes('pauses'), JSON.stringify(r.metrics));
  assert.equal(r.metrics.longPauses.length, 1);
});

test('voice-feedback: 받아쓰기가 대본과 많이 다르면 unclear, 말이 없으면 칩 대신 null', () => {
  const s = syllables(12, 4.5);
  const env = envelopeFromSamples(s, SR, 20);
  assert.ok(analyzeVoice({ envelopeDb: env, frameMs: 20, text: '가'.repeat(12), match: { kind: 'miss', closeness: 0.4 } }).chips.includes('unclear'));
  assert.ok(!analyzeVoice({ envelopeDb: env, frameMs: 20, text: '가'.repeat(12), match: { kind: 'pass', closeness: 0.95 } }).chips.includes('unclear'));
  assert.equal(analyzeVoice({ envelopeDb: envelopeFromSamples(silence(2), SR, 20), frameMs: 20, text: '가나다' }), null);
});

test('voice-feedback: 칩은 많아도 세 개까지, 중요한 순서로', () => {
  const s = concat(silence(0.3, 0.01), syllables(20, 9, 180, 0.03), silence(1.2, 0.01), syllables(4, 9, 180, 0.03));
  const r = analyzeVoice({ envelopeDb: envelopeFromSamples(s, SR, 20), frameMs: 20, text: '가'.repeat(24), match: { kind: 'miss', closeness: 0.3 } });
  assert.ok(r.chips.length <= 3);
  assert.equal(r.chips[0], 'unclear');
});

test('voice-feedback: 설정에서 켜야만(기본 꺼짐) 리딩이 끝난 화면에 칩이 나온다 — 소리는 기기 밖으로 안 나간다', async () => {
  const { readFileSync } = await import('node:fs');
  const path = (await import('node:path')).default;
  const root = path.resolve(import.meta.dirname, '..');
  const read = (rel) => readFileSync(path.join(root, rel), 'utf8');
  const { loadVoiceFeedbackEnabled, saveVoiceFeedbackEnabled } = await import('../lib/reading/voice-feedback-setting.ts');
  const mem = new Map();
  const store = { getItem: async (k) => mem.get(k) ?? null, setItem: async (k, v) => { mem.set(k, v); } };
  assert.equal(await loadVoiceFeedbackEnabled(store), false);
  await saveVoiceFeedbackEnabled(true, store);
  assert.equal(await loadVoiceFeedbackEnabled(store), true);

  const play = read('app/reading/play.tsx');
  assert.match(play, /if \(voiceFeedbackOn\.current\) await collectVoiceFeedback/);
  assert.match(play, /<VoiceFeedbackSummary items=\{lineFeedback\} \/>/);
  assert.match(play, /persist: !!session\.record \|\| voiceFeedbackOn\.current/);
  const feedback = read('lib/reading/voice-feedback.ts');
  assert.doesNotMatch(feedback, /fetch\(|api\./, '분석은 기기 안에서만');
  assert.match(read('app/settings.tsx'), /saveVoiceFeedbackEnabled/);
});
