import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { memoryStorage, stubModules } from './helpers/m4-stubs.mjs';

// 파일·저장소·압축·API 만 바꾸고 큐(upload-queue)와 검사(video-checks)는 그대로 돈다.
const state = {
  storage: memoryStorage(),
  files: new Map(),
  copyFails: false,
  deleted: [],
  kept: [],
  temporary: [],
  intents: [],
  meta: null,
  compress: async uri => ({ uri: 'file:///cache/small.mp4', originalBytes: 9_000, compressedBytes: 1_000, source: uri }),
  complete: async () => ({ id: 'video-1' }),
};
globalThis.__libraryRunner = state;
globalThis.require = name => {
  assert.equal(name, 'react-native-compressor');
  if (!state.meta) throw new Error('native module missing');
  return { getVideoMetaData: async () => state.meta };
};

stubModules({
  '@react-native-async-storage/async-storage': 'export default globalThis.__libraryRunner.storage;',
  'expo-file-system': `const s = globalThis.__libraryRunner;
    export class File {
      constructor(dir, name) { this.uri = name === undefined ? String(dir) : dir + '/' + name; }
      get exists() { return s.files.has(this.uri); }
      get size() { return s.files.get(this.uri); }
      copy(dest) { if (s.copyFails) throw new Error('copy failed'); s.files.set(dest.uri, s.files.get(this.uri)); }
    }`,
  '@/lib/account-files': `const s = globalThis.__libraryRunner;
    export const libraryDirectory = () => 'file:///docs/archive';
    export const deleteDeviceFile = async uri => { s.deleted.push(uri); s.files.delete(uri); };
    export const keepDeviceFile = async uri => { s.kept.push(uri); };
    export const trackTemporaryDeviceFile = async uri => { s.temporary.push(uri); };`,
  '@/lib/compress': 'export const compressVideo = uri => globalThis.__libraryRunner.compress(uri);',
  '@/lib/api': `const s = globalThis.__libraryRunner;
    export const api = {
      createVideoIntent: async body => { s.intents.push(body); return { intent_id: 'intent-' + s.intents.length, upload_url: 'https://s3.test/put', expires_at: '2999-01-01T00:00:00Z' }; },
      startUploadToUrl: () => ({ result: Promise.resolve({ kind: 'uploaded' }) }),
      completeVideoIntent: (intentId, requestId) => s.complete(intentId, requestId),
    };`,
});

const runner = await import('../lib/library/library-runner.ts');

const ARCHIVE = /^file:\/\/\/docs\/archive\/lib-\d+-[a-z0-9]+\.mp4$/;
let changes = 0;
runner.onLibraryChange(() => { changes += 1; });

beforeEach(() => {
  state.storage.values.clear();
  state.files.clear();
  Object.assign(state, { copyFails: false, deleted: [], kept: [], temporary: [], intents: [], meta: null });
  state.compress = async () => ({ uri: 'file:///cache/small.mp4', originalBytes: 9_000, compressedBytes: 1_000 });
  state.complete = async () => ({ id: 'video-1' });
  state.files.set('file:///cache/small.mp4', 1_000);
  changes = 0;
});

test('5분이 넘는 영상은 기기에 저장하지 않고 거른다', async () => {
  const outcome = await runner.saveRecordingToLibrary({ uri: 'file:///camera/long.mp4', durationMs: 300_001, owner: 'u1' });
  assert.deepEqual(outcome, { kind: 'rejected', code: 'video_too_long' });
  assert.deepEqual(await runner.pendingLibraryUploads('u1'), []);
});

test('찍은 영상을 보관함 폴더로 복사해 큐에 넣고, 줄인 업로드본으로 올린 뒤 기기 복사본을 남긴다', async () => {
  state.files.set('file:///camera/a.mp4', 50_000);

  const outcome = await runner.saveRecordingToLibrary({ uri: 'file:///camera/a.mp4', durationMs: 12_000, owner: 'u1' });
  assert.equal(outcome.kind, 'queued');
  assert.match(outcome.entry.uri, ARCHIVE);
  assert.equal(outcome.entry.status, 'queued');
  assert.deepEqual(state.kept, [outcome.entry.uri]);

  await runner.flushLibraryUploads('u1');

  assert.equal(state.intents.length, 1);
  assert.deepEqual(state.intents[0], {
    request_id: outcome.entry.requestId,
    content_type: 'video/mp4',
    byte_size: 1_000,
    duration_ms: 12_000,
  });
  assert.equal(runner.confirmedVideoFor(outcome.entry.id), 'video-1');
  assert.equal(runner.confirmedVideoFor('unknown'), null);
  assert.deepEqual(state.temporary, ['file:///cache/small.mp4']);
  assert.ok(state.deleted.includes('file:///cache/small.mp4'), 'temporary upload copy removed');
  assert.deepEqual(await runner.pendingLibraryUploads('u1'), []);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(await runner.localCopyFor('video-1'), outcome.entry.uri);
  assert.ok(changes > 0);
});

test('복사가 실패하고 원본도 비었으면 빈 영상으로 거른다', async () => {
  state.copyFails = true;
  const outcome = await runner.saveRecordingToLibrary({ uri: 'file:///camera/missing.mp4', durationMs: 1_000, owner: 'u1' });
  assert.deepEqual(outcome, { kind: 'rejected', code: 'video_empty' });
});

test('복사가 실패하면 원본을 그대로 가리켜 큐에 넣는다', async () => {
  state.copyFails = true;
  state.files.set('file:///camera/b.mp4', 10);
  state.complete = async () => { throw new TypeError('offline'); };
  const outcome = await runner.saveRecordingToLibrary({ uri: 'file:///camera/b.mp4', durationMs: 1_000, owner: 'u2' });
  assert.equal(outcome.kind, 'queued');
  assert.equal(outcome.entry.uri, 'file:///camera/b.mp4');
  await runner.flushLibraryUploads('u2');
  const [left] = await runner.pendingLibraryUploads('u2');
  assert.equal(left.status, 'failed');
  await runner.removePendingUpload(left.id);
  assert.deepEqual(await runner.pendingLibraryUploads('u2'), []);
  assert.ok(state.deleted.includes('file:///camera/b.mp4'));
});

test('길이를 모르면 기기에서 재고, 5분이 넘으면 올리지 않고 버린다', async () => {
  state.meta = { duration: 301 };
  state.files.set('file:///camera/c.mp4', 10);
  const entry = await runner.enqueueLibraryUpload({
    id: 'c', owner: 'u3', requestId: 'r-c', uri: 'file:///camera/c.mp4', contentType: 'video/mp4', durationMs: null, createdAt: Date.now(),
  });
  assert.equal(entry.status, 'queued');

  await runner.flushLibraryUploads('u3');

  assert.equal(state.intents.length, 0);
  assert.deepEqual(await runner.pendingLibraryUploads('u3'), []);
  assert.ok(state.deleted.includes('file:///camera/c.mp4'));
});

test('기기에서 잰 길이로 올리고, 길이를 끝내 모르면 1초로 보낸다', async () => {
  state.meta = { duration: 2.4 };
  await runner.enqueueLibraryUpload({ id: 'd', owner: 'u4', requestId: 'r-d', uri: 'file:///camera/d.mp4', contentType: 'video/mp4', durationMs: null, createdAt: Date.now() });
  await runner.flushLibraryUploads('u4');
  assert.equal(state.intents.at(-1).duration_ms, 2_400);

  state.meta = null;
  await runner.enqueueLibraryUpload({ id: 'e', owner: 'u4', requestId: 'r-e', uri: 'file:///camera/e.mp4', contentType: 'video/mp4', durationMs: null, createdAt: Date.now() });
  await runner.flushLibraryUploads('u4');
  assert.equal(state.intents.at(-1).duration_ms, 1_000);
});

test('압축이 실패해 원본이 한도를 넘으면 버리지 않고 실패로 남긴다', async () => {
  state.files.set('file:///camera/big.mp4', 200 * 1024 * 1024);
  state.compress = async uri => ({ uri, originalBytes: null, compressedBytes: null, fallback: 'timeout' });
  await runner.enqueueLibraryUpload({ id: 'big', owner: 'u5', requestId: 'r-big', uri: 'file:///camera/big.mp4', contentType: 'video/mp4', durationMs: 5_000, createdAt: Date.now() });

  await runner.flushLibraryUploads('u5');

  const [left] = await runner.pendingLibraryUploads('u5');
  assert.equal(left.status, 'failed');
  assert.equal(left.lastError, 'compress_failed');
  assert.deepEqual(state.temporary, []);
});

test('줄인 업로드본이 한도를 넘거나 비었으면 버린다', async () => {
  state.compress = async () => ({ uri: 'file:///cache/huge.mp4', originalBytes: null, compressedBytes: 101 * 1024 * 1024 });
  await runner.enqueueLibraryUpload({ id: 'huge', owner: 'u6', requestId: 'r-huge', uri: 'file:///camera/huge.mp4', contentType: 'video/mp4', durationMs: 5_000, createdAt: Date.now() });
  await runner.flushLibraryUploads('u6');
  assert.deepEqual(await runner.pendingLibraryUploads('u6'), []);

  state.compress = async () => ({ uri: 'file:///cache/gone.mp4', originalBytes: null, compressedBytes: null });
  await runner.enqueueLibraryUpload({ id: 'empty', owner: 'u6', requestId: 'r-empty', uri: 'file:///camera/empty.mp4', contentType: 'video/mp4', durationMs: 5_000, createdAt: Date.now() });
  await runner.flushLibraryUploads('u6');
  assert.deepEqual(await runner.pendingLibraryUploads('u6'), []);
  assert.equal(state.intents.length, 0);
});

test('7일이 지난 대기 영상은 버리고 그 수를 한 번만 알려 준다', async () => {
  await runner.enqueueLibraryUpload({ id: 'old', owner: 'u7', requestId: 'r-old', uri: 'file:///docs/archive/old.mp4', contentType: 'video/mp4', durationMs: 1_000, createdAt: Date.now() - 8 * 86_400_000 });
  await runner.flushLibraryUploads('u7');
  assert.equal(runner.takeDiscardedCount(), 1);
  assert.equal(runner.takeDiscardedCount(), 0);
  assert.ok(state.deleted.includes('file:///docs/archive/old.mp4'));
});

test('기기 복사본은 파일이 사라졌으면 없다고 하고, 잊으면 파일도 지운다', async () => {
  state.storage.values.set('acttub.library.localCopies', JSON.stringify({ v1: 'file:///docs/archive/v1.mp4', v2: 'file:///docs/archive/v2.mp4' }));
  state.files.set('file:///docs/archive/v1.mp4', 10);

  assert.equal(await runner.localCopyFor('v1'), 'file:///docs/archive/v1.mp4');
  assert.equal(await runner.localCopyFor('v2'), null);
  assert.equal(await runner.localCopyFor('v3'), null);

  await runner.forgetLocalCopy('v1');
  assert.equal(await runner.localCopyFor('v1'), null);
  assert.deepEqual(state.deleted, ['file:///docs/archive/v1.mp4']);
  assert.deepEqual(JSON.parse(state.storage.values.get('acttub.library.localCopies')), { v2: 'file:///docs/archive/v2.mp4' });

  await runner.forgetLocalCopy('none');
  assert.deepEqual(state.deleted, ['file:///docs/archive/v1.mp4']);
});

test('기기 복사본 기록이 깨졌으면 비어 있는 것으로 본다', async () => {
  state.storage.values.set('acttub.library.localCopies', '[1,2]');
  assert.equal(await runner.localCopyFor('v1'), null);
  state.storage.values.set('acttub.library.localCopies', '{not json');
  assert.equal(await runner.localCopyFor('v1'), null);
});
