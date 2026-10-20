import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { beforeEach, test } from 'node:test';

// fp16 묶음 받기·풀기(SOMA-747). 파일 시스템·내려받기·앱 상태만 기억 속 가짜로 바꾼다.
// 파일 내용은 `bytes` 로 두고, 크기(size)는 실제 묶음 크기를 흉내 낸다.
globalThis.__fp16Test = {};
const s = globalThis.__fp16Test;
const modules = {
  'expo-file-system': `const s = globalThis.__fp16Test;
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
      get name() { return this.uri.split('/').pop(); }
      get parentDirectory() { return { uri: this.uri.slice(0, this.uri.lastIndexOf('/')) }; }
      open() {
        const uri = this.uri;
        let offset = 0;
        return {
          readBytes(n) {
            if (s.unpackFails) throw new Error('read failed');
            const all = s.files.get(uri)?.bytes ?? new Uint8Array(0);
            const out = all.slice(offset, offset + n);
            offset += out.byteLength;
            return out;
          },
          writeBytes(chunk) {
            const cur = s.files.get(uri);
            const prev = cur.bytes ?? new Uint8Array(0);
            const next = new Uint8Array(prev.byteLength + chunk.byteLength);
            next.set(prev);
            next.set(chunk, prev.byteLength);
            s.files.set(uri, { ...cur, bytes: next, size: next.byteLength * s.f32Scale });
          },
          close() {},
        };
      }
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
  'expo-file-system/legacy': `const s = globalThis.__fp16Test;
    export function createDownloadResumable(url, fileUri, _options, onWrite, resumeData) {
      const call = { url, fileUri, resumeData: resumeData ?? null };
      s.downloads.push(call);
      return {
        downloadAsync: () => s.serve(call, onWrite),
        pauseAsync: async () => s.pauseResult,
      };
    }`,
  'react-native': `const s = globalThis.__fp16Test;
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
const DIR16 = 'file:///doc/supertonic-fp16';
const FP16 = {
  'duration_predictor.graph.onnx': 248_870,
  'duration_predictor.weights.f16': 1_729_412,
  'text_encoder.graph.onnx': 422_962,
  'text_encoder.weights.f16': 18_001_920,
  'vector_estimator.graph.onnx': 508_835,
  'vector_estimator.weights.f16': 128_026_898,
  'vocoder.graph.onnx': 77_364,
  'vocoder.weights.f16': 50_676_836,
};
const BASES = ['duration_predictor', 'text_encoder', 'vector_estimator', 'vocoder'];
const signed = (name) => `https://s3.test/reading-model/supertonic3-fp16-v1/${name}?sig=1`;
const model = () => ({
  version: 'supertonic3-fp16-v1',
  expires_in: 3600,
  files: Object.entries(FP16).map(([name, bytes]) => ({ name, bytes, url: signed(name) })),
});
// fp16 1.0, -2.0 → fp32 로 풀면 1.0, -2.0
const HALF = new Uint8Array([0x00, 0x3c, 0x00, 0xc0]);
const bigJson = (value) => JSON.stringify({ value, pad: 'x'.repeat(1000) });

function serveFp16(call, onWrite) {
  const name = decodeURIComponent(call.url.split('/').pop().split('?')[0]);
  const bytes = FP16[name];
  if (bytes === undefined) return Promise.reject(new Error(`unexpected ${call.url}`));
  onWrite({ totalBytesWritten: bytes });
  s.files.set(call.fileUri, { size: bytes, text: '', bytes: name.endsWith('.f16') ? HALF : undefined });
  return Promise.resolve({ status: 200 });
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
    ]),
    fetched: [],
    downloads: [],
    free: 10_000_000_000,
    platform: 'android',
    appState: 'active',
    listeners: [],
    pauseResult: null,
    serve: serveFp16,
    unpackFails: false,
    // 가짜 fp16 내용은 4바이트라 풀린 fp32 크기를 실제 묶음 크기만큼 부풀린다.
    f32Scale: 1,
    sourceCalls: 0,
  });
  assets.setVoiceModelSource(null);
});

const source = (impl = async () => model()) => async () => {
  s.sourceCalls += 1;
  return impl();
};

/** 풀어 둔 fp16 묶음(구조 파일 + fp32 가중치)을 기기에 둔다. */
function installUnpacked() {
  s.dirs.add(DIR16);
  for (const base of BASES) {
    s.files.set(`${DIR16}/${base}.graph.onnx`, { size: FP16[`${base}.graph.onnx`], text: '' });
    s.files.set(`${DIR16}/${base}.weights.f32`, { size: FP16[`${base}.weights.f16`] * 2, text: '' });
  }
}

test('fp16 묶음은 구조 파일과 fp16 가중치를 합쳐 약 200MB 다', () => {
  assert.equal(assets.variantBytes('fp16'), 199_693_097);
  assert.equal(assets.modelDownloadBytes('fp16'), 199_693_097);
});

test('서버 요청 함수가 꽂혀 있어야 fp16 을 쓰고, 이미 fp32 를 받은 기기는 그대로 fp32 다', () => {
  assert.equal(assets.fp16Available(), false);
  assert.equal(assets.activeVariant(), 'fp32');
  assets.setVoiceModelSource(source());
  assert.equal(assets.fp16Available(), true);
  assert.equal(assets.activeVariant(), 'fp16');
  const fp32 = 'file:///doc/supertonic-fp32';
  s.dirs.add(fp32);
  for (const [name, size] of Object.entries({
    'duration_predictor.onnx': 3_700_147,
    'text_encoder.onnx': 36_416_150,
    'vector_estimator.onnx': 256_534_781,
    'vocoder.onnx': 101_424_195,
  })) s.files.set(`${fp32}/${name}`, { size, text: '' });
  assert.equal(assets.activeVariant(), 'fp32');
});

test('서버 임시 주소로 8개를 받고, 가중치를 fp32 로 풀어 두고 fp16 은 지운다', async () => {
  assets.setVoiceModelSource(source());
  const phases = [];
  const result = await assets.downloadAssets('fp16', 'M1', (p) => phases.push(p.phase));

  assert.equal(s.sourceCalls, 1);
  assert.deepEqual(s.downloads.map((d) => d.url).sort(), Object.keys(FP16).map(signed).sort());
  assert.ok(phases.includes('download'));
  assert.ok(phases.includes('load'), '풀기는 「불러오는 중」으로 보인다');
  for (const base of BASES) {
    assert.equal(s.files.has(`${DIR16}/${base}.weights.f16`), false, `${base} fp16 은 지운다`);
    const f32 = s.files.get(`${DIR16}/${base}.weights.f32`);
    assert.deepEqual([...new Float32Array(f32.bytes.buffer)], [1, -2]);
    assert.equal(s.files.has(`${DIR16}/${base}.weights.f32.part`), false);
  }
  assert.equal(result.modelPaths.vocoder, `${DIR16}/vocoder.graph.onnx`);
  assert.equal(result.style.value, 'M1');
});

test('다 풀어 둔 기기는 서버에 묻지 않고 받지도 않는다', async () => {
  installUnpacked();
  assets.setVoiceModelSource(source());
  assert.equal(assets.assetsPresent('fp16', 'M1'), true);
  const result = await assets.downloadAssets('fp16', 'M1');
  assert.equal(s.sourceCalls, 0);
  assert.deepEqual(s.downloads, []);
  assert.equal(result.modelPaths.textEncoder, `${DIR16}/text_encoder.graph.onnx`);
});

test('풀다 만 fp32 는 버리지 않고 이어서, 풀어 둔 모델의 fp16 은 다시 받지 않는다', async () => {
  installUnpacked();
  // vocoder 만 구조 파일이 없다 — 가중치는 풀려 있으니 구조 파일만 받는다.
  s.files.delete(`${DIR16}/vocoder.graph.onnx`);
  assets.setVoiceModelSource(source());
  await assets.downloadAssets('fp16', 'M1');
  assert.deepEqual(s.downloads.map((d) => d.url), [signed('vocoder.graph.onnx')]);
});

test('서버가 묶음을 못 주면(옛 서버·미설정·네트워크) 원본 fp32 를 받는다', async () => {
  assets.setVoiceModelSource(source(async () => { throw new Error('503 voice_model_unavailable'); }));
  s.serve = (call, onWrite) => {
    onWrite({ totalBytesWritten: 1 });
    const sizes = { 'duration_predictor.onnx': 3_700_147, 'text_encoder.onnx': 36_416_150, 'vector_estimator.onnx': 256_534_781, 'vocoder.onnx': 101_424_195 };
    s.files.set(call.fileUri, { size: sizes[call.url.split('/').pop()], text: '' });
    return Promise.resolve({ status: 200 });
  };
  const result = await assets.downloadAssets('fp16', 'M1');
  assert.ok(s.downloads.every((d) => d.url.startsWith(`${HF}/onnx/`)));
  assert.equal(result.modelPaths.vocoder, 'file:///doc/supertonic-fp32/vocoder.onnx');
});

test('서버 목록에 파일이 빠져 있으면 원본 fp32 로 받는다', async () => {
  assets.setVoiceModelSource(source(async () => ({ ...model(), files: model().files.slice(0, 7) })));
  s.serve = (call, onWrite) => {
    onWrite({ totalBytesWritten: 1 });
    const sizes = { 'duration_predictor.onnx': 3_700_147, 'text_encoder.onnx': 36_416_150, 'vector_estimator.onnx': 256_534_781, 'vocoder.onnx': 101_424_195 };
    s.files.set(call.fileUri, { size: sizes[call.url.split('/').pop()], text: '' });
    return Promise.resolve({ status: 200 });
  };
  const result = await assets.downloadAssets('fp16', 'M1');
  assert.equal(result.modelPaths.vocoder, 'file:///doc/supertonic-fp32/vocoder.onnx');
});

test('받을 양과 풀 자리(fp16 두 배)가 모자라면 저장 공간 오류다', async () => {
  assets.setVoiceModelSource(source());
  s.free = 300_000_000; // 받기 200MB + 풀기 397MB 에 모자란다
  await assert.rejects(assets.downloadAssets('fp16', 'M1'), (e) => e.kind === 'storage' && e.neededBytes > 500_000_000);
  assert.deepEqual(s.downloads, []);
});

test('풀기가 실패하면 모델 불러오기 오류이고 받아 둔 fp16 은 남긴다', async () => {
  assets.setVoiceModelSource(source());
  s.unpackFails = true;
  await assert.rejects(assets.downloadAssets('fp16', 'M1'), (e) => e.kind === 'model_load');
  assert.equal(s.files.has(`${DIR16}/duration_predictor.weights.f16`), true);
  assert.equal(s.files.has(`${DIR16}/duration_predictor.weights.f32`), false);
});

test('fp16 받은 것을 지우면 묶음 폴더가 사라진다', () => {
  installUnpacked();
  assets.removeDownloadedAssets('fp16');
  assert.equal(s.dirs.has(DIR16), false);
  assert.equal(assets.assetsPresent('fp16', 'M1'), false);
});

test('남은 받을 양: fp16 묶음은 처음엔 약 200MB, 다 풀어 두면 0, 구조 파일 하나만 없으면 그만큼이다', () => {
  assert.equal(assets.missingModelBytes('fp16'), 199_693_097);
  installUnpacked();
  assert.equal(assets.missingModelBytes('fp16'), 0);
  s.files.delete(`${DIR16}/vocoder.graph.onnx`);
  assert.equal(assets.missingModelBytes('fp16'), FP16['vocoder.graph.onnx']);
});
