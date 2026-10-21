import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { beforeEach, test } from 'node:test';

// 자산 받기는 그대로 돌리고 파일 시스템·내려받기·앱 상태만 기억 속 가짜로 바꾼다.
globalThis.__assetsTest = {};
const s = globalThis.__assetsTest;
const modules = {
  'expo-file-system': `const s = globalThis.__assetsTest;
    const join = (parts) => parts.map((p) => (typeof p === 'string' ? p : p.uri)).join('/');
    export class File {
      constructor(...parts) { this.uri = join(parts); }
      get exists() { return s.files.has(this.uri); }
      get size() { return s.files.get(this.uri)?.size ?? 0; }
      textSync() { if (!s.files.has(this.uri)) throw new Error('missing'); return s.files.get(this.uri).text; }
      async text() { return this.textSync(); }
      create() { s.files.set(this.uri, { size: 0, text: '' }); }
      write(text) { s.files.set(this.uri, { size: text.length, text }); }
      delete() { if (s.stuck.has(this.uri)) throw new Error('busy'); s.files.delete(this.uri); }
      move(target) { s.files.set(target.uri, s.files.get(this.uri)); s.files.delete(this.uri); }
      static async downloadFileAsync(url, file) {
        s.fetched.push(url);
        const body = s.remote.get(url);
        if (typeof body !== 'string') throw body ?? new Error('network unreachable');
        file.write(body);
        return file;
      }
    }
    export class Directory {
      constructor(...parts) { this.uri = join(parts); }
      get exists() { return s.dirs.has(this.uri); }
      create() { s.dirs.add(this.uri); }
      delete() {
        if (s.stuck.has(this.uri)) throw new Error('busy');
        s.dirs.delete(this.uri);
        for (const uri of [...s.files.keys()]) if (uri.startsWith(this.uri + '/')) s.files.delete(uri);
      }
    }
    export const Paths = {
      document: { uri: 'file:///doc' },
      get availableDiskSpace() { if (s.free instanceof Error) throw s.free; return s.free; },
    };`,
  'expo-file-system/legacy': `const s = globalThis.__assetsTest;
    export function createDownloadResumable(url, fileUri, _options, onWrite, resumeData) {
      const call = { url, fileUri, resumeData: resumeData ?? null };
      s.downloads.push(call);
      return {
        downloadAsync: () => s.serve(call, onWrite),
        pauseAsync: async () => s.pauseResult,
      };
    }`,
  'react-native': `const s = globalThis.__assetsTest;
    export const Platform = { get OS() { return s.platform; } };
    export const AppState = {
      get currentState() { return s.appState; },
      addEventListener(_type, fn) {
        s.listeners.push(fn);
        return { remove() { s.listeners = s.listeners.filter((l) => l !== fn); } };
      },
    };`,
};
registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.endsWith('/tts/assets.ts') && modules[specifier]) {
      return { url: `data:text/javascript,${encodeURIComponent(modules[specifier])}`, shortCircuit: true };
    }
    return next(specifier, context);
  },
});
const assets = await import('../lib/reading/tts/assets.ts');

const HF = 'https://huggingface.co/Supertone/supertonic-3/resolve/main';
const DIR = 'file:///doc/supertonic-fp32';
const FP32 = {
  'duration_predictor.onnx': 3_700_147,
  'text_encoder.onnx': 36_416_150,
  'vector_estimator.onnx': 256_534_781,
  'vocoder.onnx': 101_424_195,
};
const NAMES = Object.keys(FP32);
const bigJson = (value) => JSON.stringify({ value, pad: 'x'.repeat(1000) });

/** 받기 한 번 — 절반·전부를 알리고 .part 에 다 쓴다. */
function serveWhole(call, onWrite) {
  const bytes = FP32[call.url.split('/').pop()];
  onWrite({ totalBytesWritten: Math.floor(bytes / 2) });
  onWrite({ totalBytesWritten: bytes });
  s.files.set(call.fileUri, { size: bytes, text: '' });
  return Promise.resolve({ status: 200 });
}

/** 배경으로 가서 멈췄다가 곧 돌아온다. */
function pauseThenReturn() {
  s.appState = 'background';
  for (const l of [...s.listeners]) l('background');
  setTimeout(() => {
    s.appState = 'active';
    for (const l of [...s.listeners]) l('active');
  }, 0);
  return Promise.resolve(undefined);
}

beforeEach(() => {
  Object.assign(s, {
    files: new Map(),
    dirs: new Set(),
    stuck: new Set(),
    remote: new Map([
      [`${HF}/onnx/tts.json`, bigJson('cfg')],
      [`${HF}/onnx/unicode_indexer.json`, bigJson('indexer')],
      [`${HF}/voice_styles/M1.json`, bigJson('M1')],
      [`${HF}/voice_styles/F2.json`, bigJson('F2')],
    ]),
    fetched: [],
    downloads: [],
    free: 10_000_000_000,
    platform: 'ios',
    appState: 'active',
    listeners: [],
    pauseResult: { resumeData: 'RESUME-1' },
    serve: serveWhole,
  });
});

function installAll() {
  s.dirs.add(DIR);
  for (const [name, size] of Object.entries(FP32)) s.files.set(`${DIR}/${name}`, { size, text: '' });
}

test('모델 네 개의 크기를 합쳐 처음 받을 용량으로 보인다', () => {
  assert.equal(assets.variantBytes('fp32'), 398_075_273);
  assert.equal(assets.modelDownloadBytes('int8'), 144_508_203);
  assert.deepEqual(assets.MODEL_KINDS, ['durationPredictor', 'textEncoder', 'vectorEstimator', 'vocoder']);
});

test('모델 네 개가 다 제 크기로 있어야 받아 둔 것으로 본다', () => {
  assert.equal(assets.assetsPresent('fp32', 'M1'), false);
  installAll();
  assert.equal(assets.assetsPresent('fp32', 'M1'), true);
  s.files.set(`${DIR}/vocoder.onnx`, { size: 10, text: '' });
  assert.equal(assets.assetsPresent('fp32', 'M1'), false);
  s.files.delete(`${DIR}/vocoder.onnx`);
  assert.equal(assets.assetsPresent('fp32', 'M1'), false);
});

test('받아 둔 모델을 지우고, 없거나 지우지 못해도 던지지 않는다', () => {
  installAll();
  assets.removeDownloadedAssets('fp32');
  assert.equal(s.files.size, 0);
  assert.equal(s.dirs.has(DIR), false);

  assets.removeDownloadedAssets('fp32');
  installAll();
  s.stuck.add(DIR);
  assets.removeDownloadedAssets('fp32');
  assert.equal(s.dirs.has(DIR), true);
});

test('처음 받으면 모델을 .part 로 받아 제자리로 옮기고, 진행을 알리며, 설정·글자표·목소리를 읽어 돌려준다', async () => {
  const seen = [];
  const out = await assets.downloadAssets('fp32', 'M1', (p) => seen.push(p));

  assert.deepEqual(out.modelPaths, {
    durationPredictor: `${DIR}/duration_predictor.onnx`,
    textEncoder: `${DIR}/text_encoder.onnx`,
    vectorEstimator: `${DIR}/vector_estimator.onnx`,
    vocoder: `${DIR}/vocoder.onnx`,
  });
  assert.equal(out.cfgs.value, 'cfg');
  assert.equal(out.indexer.value, 'indexer');
  assert.equal(out.style.value, 'M1');
  assert.deepEqual(s.downloads.map((d) => [d.url.split('/').pop(), d.fileUri.split('/').pop(), d.resumeData]), NAMES.map((n) => [n, `${n}.part`, null]));
  assert.equal([...s.files.keys()].some((uri) => uri.endsWith('.part')), false);
  assert.equal(assets.assetsPresent('fp32', 'M1'), true);
  assert.deepEqual(seen[0], { phase: 'download', receivedBytes: 0, totalBytes: 398_075_273, percent: 0, etaSeconds: null });
  assert.equal(seen.at(-1).percent, 100);
  assert.equal(seen.every((p) => p.phase === 'download'), true);
  assert.equal(s.listeners.length, 0);
});

test('다 받아 둔 기기는 받지 않고 받기 단계도 알리지 않는다', async () => {
  installAll();
  await assets.downloadAssets('fp32', 'M1');
  s.fetched.length = 0;
  const seen = [];

  const out = await assets.downloadAssets('fp32', 'M1', (p) => seen.push(p));
  assert.equal(out.style.value, 'M1');
  assert.deepEqual(seen, []);
  assert.deepEqual(s.downloads, []);
  assert.deepEqual(s.fetched, []);
});

test('남은 저장 공간이 모자라면 받기 전에 필요한 크기와 함께 멈춘다', async () => {
  s.free = 100_000_000;

  await assert.rejects(assets.downloadAssets('fp32', 'M1'), (e) => e.kind === 'storage' && e.neededBytes === 398_075_273);
  assert.deepEqual(s.downloads, []);
});

test('남은 공간을 모르면 막지 않고 받는다', async () => {
  s.free = new Error('unsupported');
  await assets.downloadAssets('fp32', 'M1');
  s.free = 0;
  installAll();
  s.files.delete(`${DIR}/vocoder.onnx`);
  await assets.downloadAssets('fp32', 'M1');
  assert.equal(s.downloads.length, 5);
});

test('받다 끊기면 네트워크 오류로, 저장소가 꽉 차면 저장 공간 오류로 알린다', async () => {
  s.serve = () => Promise.reject(new Error('socket hang up'));
  await assert.rejects(assets.downloadAssets('fp32', 'M1'), (e) => e.kind === 'network' && e.message === 'download failed: duration_predictor.onnx');

  s.serve = () => Promise.reject(new Error('ENOSPC: no space left on device'));
  await assert.rejects(assets.downloadAssets('fp32', 'M1'), (e) => e.kind === 'storage');
});

test('서버 오류 응답으로 받은 조각은 버리고 다시 받으며, 세 번 모두 실패하면 멈춘다', async () => {
  s.serve = (call) => {
    s.files.set(call.fileUri, { size: 10, text: '' });
    return Promise.resolve({ status: 500 });
  };

  await assert.rejects(assets.downloadAssets('fp32', 'M1'), (e) => e.kind === 'network' && e.message === 'download incomplete: duration_predictor.onnx');
  assert.equal(s.downloads.length, 3);
  assert.equal(s.files.has(`${DIR}/duration_predictor.onnx.part`), false);
});

test('Android 는 덜 받은 조각을 그 크기부터 이어받는다', async () => {
  s.platform = 'android';
  let first = true;
  s.serve = (call, onWrite) => {
    if (first) {
      first = false;
      s.files.set(call.fileUri, { size: 1_000_000, text: '' });
      return Promise.resolve({ status: 200 });
    }
    return serveWhole(call, onWrite);
  };

  await assets.downloadAssets('fp32', 'M1');
  assert.deepEqual(s.downloads.slice(0, 2).map((d) => d.resumeData), [null, '1000000']);
});

test('받는 중 앱이 배경으로 가면 멈춰 이어받기 값을 남기고, 돌아오면 그 값으로 이어받는다', async () => {
  let paused = false;
  s.serve = (call, onWrite) => {
    if (!paused) {
      paused = true;
      return pauseThenReturn();
    }
    return serveWhole(call, onWrite);
  };

  await assets.downloadAssets('fp32', 'M1');
  assert.deepEqual(s.downloads.slice(0, 2).map((d) => d.resumeData), [null, 'RESUME-1']);
  assert.equal(s.files.has(`${DIR}/duration_predictor.onnx.resume`), false);
});

test('Android 에서 멈추면 남은 조각 크기로 이어받고, 조각이 없으면 처음부터 받는다', async () => {
  s.platform = 'android';
  let round = 0;
  s.serve = (call, onWrite) => {
    round += 1;
    if (round === 1) {
      s.files.set(call.fileUri, { size: 2_000, text: '' });
      return pauseThenReturn();
    }
    if (round === 2) {
      s.files.delete(call.fileUri);
      return pauseThenReturn();
    }
    return serveWhole(call, onWrite);
  };

  await assets.downloadAssets('fp32', 'M1');
  assert.deepEqual(s.downloads.slice(0, 3).map((d) => d.resumeData), [null, '2000', null]);
});

test('멈출 때 이어받기 값을 못 받으면 돌아와서 처음부터 받는다', async () => {
  s.pauseResult = null;
  let paused = false;
  s.serve = (call, onWrite) => {
    if (!paused) {
      paused = true;
      return pauseThenReturn();
    }
    return serveWhole(call, onWrite);
  };

  await assets.downloadAssets('fp32', 'M1');
  assert.deepEqual(s.downloads.slice(0, 2).map((d) => d.resumeData), [null, null]);
});

test('지난번에 남긴 이어받기 값이 같은 주소의 것이면 그 값으로 받고, 낡았으면 처음부터 한 번 더 받는다', async () => {
  s.dirs.add(DIR);
  s.files.set(`${DIR}/duration_predictor.onnx.resume`, { size: 1, text: JSON.stringify({ url: `${HF}/onnx/duration_predictor.onnx`, resumeData: 'OLD' }) });
  s.files.set(`${DIR}/text_encoder.onnx.resume`, { size: 1, text: JSON.stringify({ url: 'https://elsewhere/text_encoder.onnx', resumeData: 'OTHER' }) });
  s.files.set(`${DIR}/vocoder.onnx.resume`, { size: 1, text: '{broken' });
  s.serve = (call, onWrite) => (call.resumeData === 'OLD' ? Promise.reject(new Error('resume data expired')) : serveWhole(call, onWrite));

  await assets.downloadAssets('fp32', 'M1');
  assert.deepEqual(s.downloads.map((d) => [d.url.split('/').pop(), d.resumeData]), [
    ['duration_predictor.onnx', 'OLD'],
    ['duration_predictor.onnx', null],
    ['text_encoder.onnx', null],
    ['vector_estimator.onnx', null],
    ['vocoder.onnx', null],
  ]);
  assert.equal([...s.files.keys()].some((uri) => uri.endsWith('.resume')), false);
});

test('이미 다 받은 조각은 받지 않고 제자리로 옮기며, 넘치는 조각과 덜 받은 완성본은 버리고 다시 받는다', async () => {
  s.dirs.add(DIR);
  s.files.set(`${DIR}/duration_predictor.onnx.part`, { size: FP32['duration_predictor.onnx'], text: '' });
  s.files.set(`${DIR}/text_encoder.onnx.part`, { size: FP32['text_encoder.onnx'] + 1, text: '' });
  s.files.set(`${DIR}/vocoder.onnx`, { size: 5, text: '' });

  await assets.downloadAssets('fp32', 'M1');
  assert.deepEqual(s.downloads.map((d) => d.url.split('/').pop()), ['text_encoder.onnx', 'vector_estimator.onnx', 'vocoder.onnx']);
  assert.equal(assets.assetsPresent('fp32', 'M1'), true);
});

test('작은 JSON 이 깨졌으면 지우고 한 번 다시 받으며, 그래도 깨졌으면 형식 오류로 멈춘다', async () => {
  installAll();
  s.remote.set(`${HF}/onnx/tts.json`, '{not json');

  await assert.rejects(assets.downloadAssets('fp32', 'M1'), (e) => e.kind === 'parse' && e.message === 'bad json: tts.json');
  assert.equal(s.fetched.filter((u) => u.endsWith('tts.json')).length, 2);
});

test('JSON 을 받지 못하면 네트워크 오류로 멈춘다', async () => {
  installAll();
  s.remote.delete(`${HF}/onnx/unicode_indexer.json`);

  await assert.rejects(assets.downloadAssets('fp32', 'M1'), (e) => e.kind === 'network' && e.message === 'download failed: unicode_indexer.json');
});

test('목소리 스타일만 따로 받아 읽고, 받아 둔 것은 다시 받지 않는다', async () => {
  assert.equal((await assets.downloadVoiceStyle('fp32', 'F2')).value, 'F2');
  assert.equal((await assets.downloadVoiceStyle('fp32', 'F2')).value, 'F2');
  assert.deepEqual(s.fetched, [`${HF}/voice_styles/F2.json`]);
});

test('깨진 캐시 파일을 지우지 못해도 다시 받아 본다', async () => {
  s.dirs.add(DIR);
  s.files.set(`${DIR}/F2.json`, { size: 2000, text: '{oops' });
  s.stuck.add(`${DIR}/F2.json`);

  await assert.rejects(assets.downloadVoiceStyle('fp32', 'F2'), (e) => e.kind === 'parse');
});

test('배경 전환이 끝없이 이어지면 50번에서 받기를 그만둔다', async () => {
  s.serve = () => pauseThenReturn();

  await assert.rejects(assets.downloadAssets('fp32', 'M1'), (e) => e.kind === 'network' && e.message === 'download failed: duration_predictor.onnx');
  assert.equal(s.downloads.length, 50);
});

test('아직 받을 모델 용량은 받아 둔 파일과 이어받을 조각만큼 뺀다 — 다 있으면 0이라 다시 묻지 않는다(SOMA-772)', () => {
  assert.equal(assets.missingModelBytes('fp32'), 398_075_273);
  installAll();
  assert.equal(assets.missingModelBytes('fp32'), 0);
  s.files.delete(`${DIR}/vocoder.onnx`);
  s.files.set(`${DIR}/vocoder.onnx.part`, { size: FP32['vocoder.onnx'] - 1000, text: '' });
  assert.equal(assets.missingModelBytes('fp32'), 1000);
});
