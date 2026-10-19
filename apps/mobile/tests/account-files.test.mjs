import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { memoryStorage, stubModules } from './helpers/m4-stubs.mjs';

// 파일 시스템과 저장소만 바꾸고 장부 규칙(device-files)·음성 파일 이름 규칙은 그대로 돈다.
const state = { storage: memoryStorage(), files: new Set(), deleted: [], dirs: new Set(), cache: 'file:///cache/', listFails: false, createFails: false };
globalThis.__accountFiles = state;
stubModules({
  '@react-native-async-storage/async-storage': 'export default globalThis.__accountFiles.storage;',
  'expo-file-system': `const s = globalThis.__accountFiles;
    export const Paths = { document: 'file:///docs' };
    export class Directory {
      constructor(parent, name) { this.uri = parent + '/' + name; }
      get exists() { return s.dirs.has(this.uri); }
      create(options) { if (s.createFails) throw new Error('exists'); s.dirs.add(this.uri); s.createOptions = options; }
      delete() { if (s.deleteDirFails) throw new Error('busy'); s.dirs.delete(this.uri); s.deleted.push(this.uri); }
    }`,
  'expo-file-system/legacy': `const s = globalThis.__accountFiles;
    export const deleteAsync = async (uri, options) => { if (uri.includes('locked')) throw new Error('locked'); s.deleted.push([uri, options]); s.files.delete(uri); };
    export const getInfoAsync = async uri => ({ exists: s.files.has(uri) });
    export const readDirectoryAsync = async dir => { if (s.listFails) throw new Error('io'); return [...s.files].filter(uri => uri.startsWith(dir)).map(uri => uri.slice(dir.length)); };
    export let cacheDirectory = null;
    export const setCacheDirectory = value => { cacheDirectory = value; };`,
});

const { setCacheDirectory } = await import('expo-file-system/legacy');
const files = await import('../lib/account-files.ts');

beforeEach(() => {
  state.storage.values.clear();
  state.files = new Set();
  Object.assign(state, { deleted: [], dirs: new Set(), listFails: false, createFails: false, deleteDirFails: false });
  setCacheDirectory('file:///cache/');
});

test('파일 지우기는 없는 파일이어도 던지지 않게 지운다', async () => {
  state.files.add('file:///cache/a.jpg');
  await files.deleteDeviceFile('file:///cache/a.jpg');
  assert.deepEqual(state.deleted, [['file:///cache/a.jpg', { idempotent: true }]]);
});

test('앱을 켤 때 남은 임시 파일을 지우고, 사라진 보관 파일은 장부에서 뺀다', async () => {
  state.files.add('file:///cache/tmp.mp4');
  state.files.add('file:///docs/archive/keep.mp4');
  await files.trackTemporaryDeviceFile('file:///cache/tmp.mp4');
  await files.keepDeviceFile('file:///docs/archive/keep.mp4');
  await files.keepDeviceFile('file:///docs/archive/gone.mp4');

  await files.sweepDeviceFiles();

  assert.deepEqual(state.deleted, [['file:///cache/tmp.mp4', { idempotent: true }]]);
  assert.deepEqual(JSON.parse(state.storage.values.get('device.accountFiles')), { temporary: [], kept: ['file:///docs/archive/keep.mp4'] });
});

test('다 쓴 파일을 지우고, 탈퇴 때는 장부의 파일을 전부 지운다', async () => {
  await files.trackTemporaryDeviceFile('file:///cache/small.jpg');
  await files.keepDeviceFile('file:///docs/archive/k.mp4');
  await files.discardDeviceFiles(['file:///cache/small.jpg']);
  assert.deepEqual(JSON.parse(state.storage.values.get('device.accountFiles')), { temporary: [], kept: ['file:///docs/archive/k.mp4'] });

  await files.purgeDeviceFiles();
  assert.deepEqual(state.deleted.map(([uri]) => uri), ['file:///cache/small.jpg', 'file:///docs/archive/k.mp4']);
  assert.equal(state.storage.values.has('device.accountFiles'), false);
});

test('보관함 폴더를 만들어 돌려주고, 만들 수 없어도 같은 자리를 돌려준다', () => {
  const dir = files.libraryDirectory();
  assert.equal(dir.uri, 'file:///docs/archive');
  assert.deepEqual(state.createOptions, { intermediates: true, idempotent: true });
  state.createFails = true;
  assert.equal(files.libraryDirectory().uri, 'file:///docs/archive');
});

test('탈퇴 때 보관함 폴더를 통째로 지우고, 없거나 못 지워도 던지지 않는다', async () => {
  await files.purgeLibraryFiles();
  assert.deepEqual(state.deleted, []);
  state.dirs.add('file:///docs/archive');
  await files.purgeLibraryFiles();
  assert.deepEqual(state.deleted, ['file:///docs/archive']);
  state.dirs.add('file:///docs/archive');
  state.deleteDirFails = true;
  await files.purgeLibraryFiles();
  assert.equal(state.dirs.has('file:///docs/archive'), true);
});

test('캐시 폴더의 대본 음성 파일만 고르고, 대본 하나를 지우면 그 대본의 음성만 지운다', async () => {
  for (const name of ['reading-s1-line1.wav', 'reading-s1-line2.wav', 'reading-s2-line1.wav', 'other.wav', 'reading-s1-locked.wav']) {
    state.files.add(`file:///cache/${name}`);
  }
  assert.deepEqual((await files.listSpeechFiles()).sort(), [
    'file:///cache/reading-s1-line1.wav', 'file:///cache/reading-s1-line2.wav',
    'file:///cache/reading-s1-locked.wav', 'file:///cache/reading-s2-line1.wav',
  ]);

  await files.deleteSpeechFilesOfScript('s1');
  assert.deepEqual([...state.files].sort(), ['file:///cache/other.wav', 'file:///cache/reading-s1-locked.wav', 'file:///cache/reading-s2-line1.wav']);

  state.listFails = true;
  await files.deleteSpeechFilesOfScript('s2');
  assert.equal(state.files.has('file:///cache/reading-s2-line1.wav'), true);
});

test('캐시 폴더를 모르면 음성 파일이 없는 것으로 본다', async () => {
  setCacheDirectory(null);
  assert.deepEqual(await files.listSpeechFiles(), []);
  await files.deleteSpeechFilesOfScript('s1');
  assert.deepEqual(state.deleted, []);
});
