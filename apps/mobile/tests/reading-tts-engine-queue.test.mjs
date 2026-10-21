import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { beforeEach, test } from 'node:test';

// 엔진은 그대로 실행하고 파일·모델·재생기 등 네이티브 경계만 대체한다(reading-engine.test.mjs 와 같은 방식).
globalThis.__engineQueueTest = {};
const s = globalThis.__engineQueueTest;
const modules = {
  'expo-file-system': `const s = globalThis.__engineQueueTest;
    export const Paths = { cache: 'file:///cache' };
    export class File {
      constructor(root, name) { this.uri = root + '/' + name; }
      get exists() { return s.files.has(this.uri); }
      write(bytes) { s.files.set(this.uri, bytes); }
    }`,
  'expo-audio': `const s = globalThis.__engineQueueTest;
    export async function setAudioModeAsync() {}
    export function createAudioPlayer(source) {
      const p = {
        source, listener: null, removed: false,
        addListener(_e, fn) { this.listener = fn; return { remove: () => { this.listener = null; } }; },
        play() { if (s.playFails) throw new Error('audio session busy'); },
        pause() {}, remove() { this.removed = true; }, release() {},
      };
      s.players.push(p);
      return p;
    }`,
  '../../i18n.ts': `export const currentLanguage = () => globalThis.__engineQueueTest.language; export const translate = (k) => k;`,
  '../network': `export async function currentNetworkType() { return 'wifi'; }`,
  '../voice-capability.ts': `export async function readAppVoiceSupport() { return { unsupported: false }; }`,
  './assets': `const s = globalThis.__engineQueueTest;
    export const MODEL_KINDS = ['durationPredictor', 'vocoder'];
    export function assetsPresent() { return false; }
    export function activeVariant() { return 'fp32'; }
    export async function downloadAssets(_variant, preset, onProgress) {
      s.downloads += 1;
      onProgress({ phase: 'download', receivedBytes: 1, totalBytes: 2, percent: 50, etaSeconds: null });
      if (s.downloadGate) await s.downloadGate;
      return { modelPaths: { durationPredictor: 'file:///dp.onnx', vocoder: 'file:///voc.onnx' }, style: preset, cfgs: {}, indexer: [] };
    }
    export async function downloadVoiceStyle(_variant, preset) { return preset; }`,
  './helper.native.js': `const s = globalThis.__engineQueueTest;
    export async function loadOnnx(path, options) {
      s.loads.push([path, options.executionProviders]);
      if (s.loadFailures.has(path + ':' + options.executionProviders[0])) throw new Error('bad model');
      return {};
    }
    export const loadVoiceStyleFromObjects = (styles) => styles[0];
    export const writeWavFile = (samples) => new Uint8Array(samples.length);
    export class UnicodeProcessor {}
    export class TextToSpeech {
      sampleRate = 24000;
      async call(text, locale, voice) { s.calls.push({ text, locale, voice }); return { wav: [0.1, 0.2], duration: [1] }; }
    }`,
};
registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.endsWith('/tts/engine.ts') && modules[specifier]) {
      return { url: `data:text/javascript,${encodeURIComponent(modules[specifier])}`, shortCircuit: true };
    }
    return next(specifier, context);
  },
});
const engine = await import('../lib/reading/tts/engine.ts');

beforeEach(() => {
  engine._reset();
  Object.assign(s, {
    files: new Map(),
    players: [],
    calls: [],
    loads: [],
    loadFailures: new Set(),
    downloads: 0,
    downloadGate: null,
    playFails: false,
    language: 'ko',
  });
});

const ready = () => engine.ensureReady();

test('고품질 목소리 큐는 서버 음성을 받아 쓰고, 기기 엔진을 깨우지 않는다', async () => {
  const asked = [];
  const queue = engine.createQueueFor('s1', {
    cloud: true,
    synthesizeCloud: async (text, scriptId, preset) => {
      asked.push([text, scriptId, preset]);
      return `file:///cloud/${preset}.mp3`;
    },
  });

  queue.prime([{ text: '먼저 왔어?', preset: 'F2' }]);
  await queue.first();
  assert.equal(await queue.take({ text: '먼저 왔어?', preset: 'F2' }), 'file:///cloud/F2.mp3');
  assert.deepEqual(asked, [['먼저 왔어?', 's1', 'F2']]);
  assert.equal(s.calls.length, 0);
});

test('서버 음성이 한도(429)로 막히면 그 회차는 기기 목소리로만 만든다', async () => {
  await ready();
  let asked = 0;
  const queue = engine.createQueueFor('s1', {
    cloud: true,
    synthesizeCloud: async () => {
      asked += 1;
      throw Object.assign(new Error('limit'), { status: 429 });
    },
  });

  queue.prime([{ text: '하나', preset: 'M1' }, { text: '둘', preset: 'M1' }]);
  await queue.first();
  await queue.first();
  assert.match(await queue.take({ text: '하나', preset: 'M1' }), /^file:\/\/\/cache\/.+\.wav$/);
  assert.match(await queue.take({ text: '둘', preset: 'M1' }), /^file:\/\/\/cache\/.+\.wav$/);
  assert.equal(asked, 1);
  assert.deepEqual(s.calls.map((c) => c.text), ['하나', '둘']);
});

test('일시적인 서버 오류는 그 줄만 기기 목소리로 만들고 다음 줄은 다시 서버에 묻는다', async () => {
  await ready();
  let asked = 0;
  const queue = engine.createQueueFor('s1', {
    cloud: true,
    synthesizeCloud: async () => {
      asked += 1;
      throw Object.assign(new Error('server'), { status: 500 });
    },
  });

  queue.prime([{ text: '하나', preset: 'M1' }, { text: '둘', preset: 'M1' }]);
  await queue.first();
  await queue.first();
  assert.equal(asked, 2);
  assert.equal(s.calls.length, 2);
});

test('서버 음성이 실패했는데 기기 엔진도 준비 전이면 그 줄은 만들지 못한다', async () => {
  const queue = engine.createQueueFor('s1', {
    cloud: true,
    synthesizeCloud: async () => {
      throw new Error('offline');
    },
  });

  queue.prime([{ text: '하나', preset: 'M1' }]);
  await queue.first();
  assert.equal(await queue.take({ text: '하나', preset: 'M1' }), null);
});

test('서버가 요청을 거절(400)한 줄은 줄이 넘어가 큐를 다시 잡아도 서버에 다시 보내지 않는다', async () => {
  // 화면은 줄이 바뀔 때마다 prime 을 다시 부르고, 못 만든 줄은 다시 만들 대상으로 남는다(10/19 같은 줄 99번 요청).
  const asked = [];
  const queue = engine.createQueueFor('s1', {
    cloud: true,
    synthesizeCloud: async (text) => {
      asked.push(text);
      throw Object.assign(new Error('invalid'), { status: 400 });
    },
  });
  const lines = [{ text: '긴 대사', preset: 'M1' }];

  for (let i = 0; i < 3; i += 1) {
    queue.prime(lines);
    await queue.first();
  }
  assert.deepEqual(asked, ['긴 대사']);
  assert.equal(await queue.take(lines[0]), null);

  await ready();
  queue.prime(lines);
  await queue.first();
  assert.deepEqual(asked, ['긴 대사']);
  assert.match(await queue.take(lines[0]), /^file:\/\/\/cache\/.+\.wav$/);
});

test('기기 엔진이 준비 전이면 합성은 준비되지 않았다는 오류다', async () => {
  await assert.rejects(engine.synthesize('하나', 's1'), /reading.voiceNotReady/);
  await ready();
  assert.equal(await engine.synthesize('   ', 's1'), null);
});

test('미리 듣기는 앱 말의 예문을 그 프리셋으로 읽는다', async () => {
  await ready();
  const ko = engine.preview('F3');
  await new Promise((resolve) => setImmediate(resolve));
  s.players.at(-1).listener({ didJustFinish: true });
  await ko;

  s.language = 'en';
  const en = engine.preview('M2');
  await new Promise((resolve) => setImmediate(resolve));
  s.players.at(-1).listener({ didJustFinish: true });
  await en;

  assert.deepEqual(s.calls.map((c) => [c.text, c.locale, c.voice]), [
    ['안녕하세요, 이 목소리로 읽어 드릴게요.', 'ko', 'F3'],
    ['Hello, I will read the lines in this voice.', 'en', 'M2'],
  ]);
});

test('재생기를 틀지 못하면 그 오류를 돌려준다', async () => {
  s.playFails = true;

  await assert.rejects(engine.play('file:///cache/a.wav'), /audio session busy/);
  assert.equal(s.players[0].listener, null);
});

test('모델을 기본 실행기로 못 올리면 CPU 로 한 번 더 올린다', async () => {
  s.loadFailures.add('file:///voc.onnx:xnnpack');

  await ready();
  assert.equal(engine.isReady(), true);
  assert.deepEqual(s.loads, [
    ['file:///dp.onnx', ['xnnpack']],
    ['file:///voc.onnx', ['xnnpack']],
    ['file:///voc.onnx', ['cpu']],
  ]);
});

test('CPU 로도 못 올리면 모델 불러오기 실패로 알리고, 다음 준비는 처음부터 다시 한다', async () => {
  s.loadFailures.add('file:///voc.onnx:xnnpack');
  s.loadFailures.add('file:///voc.onnx:cpu');

  await assert.rejects(ready(), (e) => e.kind === 'model_load');
  assert.equal(engine.isReady(), false);
  s.loadFailures.clear();
  await ready();
  assert.equal(s.downloads, 2);
});

test('이미 준비됐으면 다시 받지 않고, 진행을 지켜보던 화면의 오류는 다른 화면을 막지 않는다', async () => {
  let release;
  s.downloadGate = new Promise((resolve) => (release = resolve));
  const seen = [];
  const first = engine.ensureReady(() => {
    throw new Error('screen gone');
  });
  const second = engine.ensureReady((p) => seen.push(p.phase));
  release();
  await Promise.all([first, second]);

  assert.deepEqual(seen, ['download', 'load', 'load', 'load', 'ready']);
  await engine.ensureReady((p) => seen.push(p.phase));
  assert.equal(s.downloads, 1);
  assert.equal(seen.length, 5);
});
