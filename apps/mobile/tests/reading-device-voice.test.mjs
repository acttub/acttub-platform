import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { beforeEach, test } from 'node:test';

// 기기 기본 목소리(expo-speech)만 가짜로 바꾼다. 말 코드·높낮이 규칙은 진짜를 쓴다.
globalThis.__deviceVoiceTest = {};
const s = globalThis.__deviceVoiceTest;
const SPEECH = `const s = globalThis.__deviceVoiceTest;
  export async function getAvailableVoicesAsync() { if (s.voices instanceof Error) throw s.voices; return s.voices; }
  export function speak(text, options) { if (s.speakFails) throw new Error('tts engine missing'); s.spoken.push([text, options]); }
  export function stop() { s.stops += 1; if (s.stopGate) return s.stopGate; return s.stopFails ? Promise.reject(new Error('not speaking')) : Promise.resolve(); }`;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'expo-speech' && context.parentURL?.endsWith('/tts/device-voice.ts')) {
      return { url: `data:text/javascript,${encodeURIComponent(SPEECH)}`, shortCircuit: true };
    }
    return next(specifier, context);
  },
});
const voice = await import('../lib/reading/tts/device-voice.ts');

beforeEach(() => {
  Object.assign(s, { voices: [], spoken: [], stops: 0, speakFails: false, stopFails: false, stopGate: null });
});

test('기기에 앱 말(한국어)의 음성이 있어야 기기 목소리를 쓴다', async () => {
  s.voices = [{ language: 'en-US' }, { language: 'ko_KR' }];
  assert.equal(await voice.hasDeviceVoice(), true);
  s.voices = [{ language: 'en-US' }];
  assert.equal(await voice.hasDeviceVoice(), false);
  s.voices = [];
  assert.equal(await voice.hasDeviceVoice(), true);
  s.voices = new Error('no service');
  assert.equal(await voice.hasDeviceVoice(), false);
});

test('대사를 프리셋의 높낮이로 읽고, 다 읽거나 멈추거나 실패하면 끝난다', async () => {
  const reading = voice.speakWithDevice('  가지 마  ', 'F2');
  const [text, options] = s.spoken[0];
  assert.equal(text, '가지 마');
  assert.deepEqual({ language: options.language, pitch: options.pitch, rate: options.rate }, { language: 'ko-KR', pitch: 1.2, rate: 1 });
  options.onDone();
  options.onError();
  await reading;

  const slow = voice.speakWithDevice('천천히', 'M4', { rate: 0.7 });
  assert.deepEqual([s.spoken[1][1].pitch, s.spoken[1][1].rate], [0.8, 0.7]);
  s.spoken[1][1].onStopped();
  await slow;

  const unknown = voice.speakWithDevice('누구', 'custom');
  assert.equal(s.spoken[2][1].pitch, 1);
  s.spoken[2][1].onError();
  await unknown;
});

test('빈 대사는 읽지 않고, 음성 엔진이 없으면 바로 끝낸다', async () => {
  await voice.speakWithDevice('   ', 'F1');
  await voice.speakWithDevice(undefined, 'F1');
  assert.deepEqual(s.spoken, []);

  s.speakFails = true;
  await voice.speakWithDevice('하나', 'F1');
});

test('멈추기는 읽는 것이 없어도 던지지 않는다', async () => {
  s.stopFails = true;
  voice.stopDeviceVoice();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(s.stops, 1);
});

test('줄을 넘기자마자 읽어도 앞의 멈추기가 끝난 뒤에 읽는다 — 늦은 멈추기가 새 줄을 끊지 않게', async () => {
  let release;
  s.stopGate = new Promise((resolve) => { release = resolve; });
  voice.stopDeviceVoice();
  const reading = voice.speakWithDevice('다음 줄', 'F1');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(s.spoken.length, 0);
  release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(s.spoken[0][0], '다음 줄');
  s.spoken[0][1].onDone();
  await reading;
});

test('[다음]을 연타해 기다리는 사이 또 멈췄으면 지나간 줄은 읽지 않고 마지막 줄만 읽는다', async () => {
  let release;
  s.stopGate = new Promise((resolve) => { release = resolve; });
  voice.stopDeviceVoice();
  const skipped = voice.speakWithDevice('지나간 줄', 'F1');
  voice.stopDeviceVoice();
  const landed = voice.speakWithDevice('도착한 줄', 'F1');
  release();
  await skipped;
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(s.spoken.map(([text]) => text), ['도착한 줄']);
  s.spoken[0][1].onDone();
  await landed;
});

test('멈추기가 끝을 알리지 않아도 잠깐 뒤에는 읽는다', async () => {
  s.stopGate = new Promise(() => {});
  voice.stopDeviceVoice();
  const reading = voice.speakWithDevice('그래도 읽는다', 'F1');
  await new Promise((resolve) => setTimeout(resolve, voice.STOP_WAIT_MAX_MS + 50));
  assert.equal(s.spoken[0][0], '그래도 읽는다');
  s.spoken[0][1].onDone();
  await reading;
});
