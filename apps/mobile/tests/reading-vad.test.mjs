import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_VAD, createSilenceDetector, meteringToRms } from '../lib/reading/vad.ts';

/** now 부터 dur 동안 rms 를 50ms 마다 먹인다. 첫 non-none 사건을 돌려준다. */
function feedFor(detector, rms, from, dur) {
  const events = [];
  for (let t = from; t < from + dur; t += 50) {
    const ev = detector.feed(rms, t);
    if (ev !== 'none') events.push([ev, t]);
  }
  return events;
}

test('reading.session: 침묵 감지 상수는 웹과 같다 — RMS 0.015, 400ms, 1.8초, 60초', () => {
  assert.deepEqual(DEFAULT_VAD, { threshold: 0.015, silenceMs: 1800, minSpeechMs: 400, maxListenMs: 60000 });
});

test('reading.session: read·silence로 500ms 말하고 1.8초 침묵이면 다음 줄 신호(speech_end)가 난다', () => {
  const d = createSilenceDetector(DEFAULT_VAD, 0);
  const speech = feedFor(d, 0.05, 0, 500);
  assert.deepEqual(speech.map(([e]) => e), ['speech_start']);
  const quiet = feedFor(d, 0.001, 500, 1900);
  assert.deepEqual(quiet.map(([e]) => e), ['speech_end']);
  assert.ok(quiet[0][1] >= 500 + 1800 - 50, '1.8초 침묵 뒤에 난다');
});

test('reading.session: 300ms 소리 뒤 침묵은 넘어가지 않는다(소음)', () => {
  const d = createSilenceDetector(DEFAULT_VAD, 0);
  feedFor(d, 0.05, 0, 300);
  const quiet = feedFor(d, 0.001, 300, 3000);
  assert.deepEqual(quiet.map(([e]) => e), []);
});

test('reading.session: 아무 말 없이 60초가 지나면 넘기지 않고 timeout 신호로 안내만 한다', () => {
  const d = createSilenceDetector(DEFAULT_VAD, 0);
  const events = feedFor(d, 0.001, 0, 61_000);
  assert.deepEqual(events.map(([e]) => e), ['timeout']);
  assert.ok(events[0][1] >= 60_000);
});

test('reading.session: 소리가 임계 미만이면 말 시작으로 보지 않는다', () => {
  const d = createSilenceDetector(DEFAULT_VAD, 0);
  assert.deepEqual(feedFor(d, 0.0149, 0, 1000), []);
  assert.deepEqual(feedFor(d, 0.015, 1000, 50).map(([e]) => e), ['speech_start']);
});

test('reading.session: 녹음기의 dBFS 미터링을 RMS(0~1)로 바꾼다 — 0dB는 1, -36.5dB쯤이 임계 0.015', () => {
  assert.equal(meteringToRms(0), 1);
  assert.ok(Math.abs(meteringToRms(-36.5) - 0.015) < 0.0005);
  assert.equal(meteringToRms(-160), 1e-8);
  assert.equal(meteringToRms(undefined), 0);
  assert.equal(meteringToRms(Number.NaN), 0);
});
