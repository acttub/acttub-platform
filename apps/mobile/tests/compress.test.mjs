import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';

import { stubModules } from './helpers/stub-modules.mjs';

// react-native-compressor·파일 크기·OS 만 바꾸고 비트레이트·시간 상한 규칙은 그대로 돈다.
mock.timers.enable({ apis: ['setTimeout'] });
const state = { os: 'ios', sizes: new Map(), calls: [], meta: { duration: 60 }, compress: null, module: true };
globalThis.__compress = state;
const compressor = {
  getVideoMetaData: async () => { if (state.meta instanceof Error) throw state.meta; return state.meta; },
  Video: {
    compress: (uri, options) => { state.calls.push(['compress', uri, { ...options, getCancellationId: typeof options.getCancellationId }]); return state.compress(options); },
    cancelCompression: id => { state.calls.push(['cancel', id]); if (state.cancelThrows) throw new Error('gone'); },
  },
};
globalThis.require = name => {
  assert.equal(name, 'react-native-compressor');
  if (!state.module) throw new Error('native module missing');
  return compressor;
};
stubModules({
  'react-native': 'export const Platform = { get OS() { return globalThis.__compress.os; } };',
  'expo-file-system/legacy': `const s = globalThis.__compress;
    export const getInfoAsync = async uri => { if (uri === 'file:///broken.mp4') throw new Error('io'); return s.sizes.has(uri) ? { exists: true, size: s.sizes.get(uri) } : { exists: false }; };`,
});

const { bitrateForDuration, compressVideo } = await import('../lib/compress.ts');
const settle = async () => { for (let i = 0; i < 10; i += 1) await new Promise(resolve => setImmediate(resolve)); };

beforeEach(() => {
  Object.assign(state, { os: 'ios', calls: [], meta: { duration: 60 }, module: true, cancelThrows: false });
  state.sizes = new Map([['file:///in.mp4', 40_000_000], ['file:///out.mp4', 5_000_000]]);
  state.compress = async () => 'file:///out.mp4';
});

test('길이로 6MB 목표 비트레이트를 정하되 화질 하한과 상한 안에 둔다', () => {
  assert.equal(bitrateForDuration(60), 774_861);
  assert.equal(bitrateForDuration(10), 1_200_000);
  assert.equal(bitrateForDuration(300), 300_000);
});

test('길이를 알면 그 비트레이트로 720px 에 맞춰 줄이고 전후 크기를 돌려준다', async () => {
  assert.deepEqual(await compressVideo('file:///in.mp4'), { uri: 'file:///out.mp4', originalBytes: 40_000_000, compressedBytes: 5_000_000 });
  assert.deepEqual(state.calls, [['compress', 'file:///in.mp4', {
    compressionMethod: 'manual', bitrate: 774_861, maxSize: 720, progressDivider: 5, getCancellationId: 'function',
  }]]);
});

test('길이를 못 읽으면 자동 모드로 줄인다', async () => {
  for (const meta of [new Error('no meta'), { duration: 0 }, null]) {
    state.calls = [];
    state.meta = meta;
    await compressVideo('file:///in.mp4');
    assert.deepEqual(state.calls[0][2], { compressionMethod: 'auto', maxSize: 720, progressDivider: 5, getCancellationId: 'function' });
  }
});

test('웹이나 모듈이 없는 빌드는 원본을 그대로 돌려준다', async () => {
  state.os = 'web';
  assert.deepEqual(await compressVideo('file:///in.mp4'), { uri: 'file:///in.mp4', originalBytes: null, compressedBytes: null });
  state.os = 'android';
  state.module = false;
  assert.deepEqual(await compressVideo('file:///in.mp4'), { uri: 'file:///in.mp4', originalBytes: null, compressedBytes: null });
  assert.deepEqual(state.calls, []);
});

test('크기를 못 읽은 파일은 크기를 null 로 둔다', async () => {
  state.compress = async () => 'file:///missing-out.mp4';
  assert.deepEqual(await compressVideo('file:///broken.mp4'), { uri: 'file:///missing-out.mp4', originalBytes: null, compressedBytes: null });
});

test('압축이 실패하면 진행 중인 압축을 취소하고 원본을 올리라고 알린다', async () => {
  state.compress = async options => { options.getCancellationId('job-1'); throw new Error('codec'); };
  assert.deepEqual(await compressVideo('file:///in.mp4'), { uri: 'file:///in.mp4', originalBytes: 40_000_000, compressedBytes: null, fallback: 'error' });
  assert.deepEqual(state.calls.at(-1), ['cancel', 'job-1']);

  state.cancelThrows = true;
  assert.equal((await compressVideo('file:///in.mp4')).fallback, 'error');
});

test('길이로 정한 시간 안에 끝나지 않으면 취소하고 원본을 올리라고 알린다', async () => {
  state.meta = { duration: 3 };
  state.compress = options => { options.getCancellationId('job-2'); return new Promise(() => {}); };
  const result = compressVideo('file:///in.mp4');
  await settle();
  mock.timers.tick(51_000);
  assert.deepEqual(await result, { uri: 'file:///in.mp4', originalBytes: 40_000_000, compressedBytes: null, fallback: 'timeout' });
  assert.deepEqual(state.calls.filter(([name]) => name === 'cancel'), [['cancel', 'job-2'], ['cancel', 'job-2']]);
});
