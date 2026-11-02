import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { stubModules } from './helpers/stub-modules.mjs';

// 게시판 사진(SOMA-873) — 사진 고르기·권한·압축·파일 크기·서버만 바꾸고 올리는 순서(community-image)는 그대로 돈다.
const state = { calls: [], permission: null, picked: null, compressor: true, sizes: new Map(), upload: 'uploaded' };
globalThis.__cimg = state;
globalThis.require = (name) => {
  if (name !== 'react-native-compressor' || !state.compressor) throw new Error(`Cannot find module '${name}'`);
  return { Image: { compress: async (uri, options) => { state.calls.push(['compress', uri, options.maxWidth, options.maxHeight]); return `${uri}.small.jpg`; } } };
};
stubModules({
  'expo-image-picker': `const s = globalThis.__cimg;
    export const requestMediaLibraryPermissionsAsync = async () => { s.calls.push(['permission']); return s.permission; };
    export const launchImageLibraryAsync = async options => { s.calls.push(['pick', options]); return s.picked; };`,
  'expo-file-system/legacy': `const s = globalThis.__cimg;
    export const getInfoAsync = async uri => s.sizes.has(uri) ? { exists: true, size: s.sizes.get(uri) } : { exists: false };`,
  '@/lib/account-files': `const s = globalThis.__cimg;
    export const trackTemporaryDeviceFile = async uri => { s.calls.push(['track', uri]); };
    export const discardDeviceFiles = async uris => { s.calls.push(['discard', uris]); };`,
  '@/lib/api': `const s = globalThis.__cimg;
    export const api = {
      createCommunityImageIntent: async input => { s.calls.push(['intent', input]); return { image_id: 'img-1', upload_url: 'https://s3.test/c', upload_headers: { 'x-amz-meta-a': '1' }, expires_at: 'x' }; },
      completeCommunityImage: async id => { s.calls.push(['complete', id]); return {}; },
      startUploadToUrl: (url, uri, type, headers) => { s.calls.push(['put', url, uri, type, headers]); return { result: Promise.resolve({ kind: s.upload }) }; },
    };`,
});

const picker = await import('../lib/community-image-picker.ts');

beforeEach(() => {
  Object.assign(state, {
    calls: [],
    permission: { granted: true, canAskAgain: true },
    picked: { canceled: false, assets: [{ uri: 'file:///cache/a.jpg' }, { uri: 'file:///cache/b.jpg' }] },
    compressor: true,
    upload: 'uploaded',
  });
  state.sizes = new Map([['file:///cache/a.jpg.small.jpg', 300_000]]);
});

test('권한을 묻고 여러 장을 고른 순서대로 남은 자리만큼 고른다', async () => {
  assert.deepEqual(await picker.pickCommunityImages(3), { kind: 'picked', uris: ['file:///cache/a.jpg', 'file:///cache/b.jpg'] });
  assert.deepEqual(state.calls, [
    ['permission'],
    ['pick', { mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: 3, orderedSelection: true, quality: 1 }],
  ]);
});

test('자리가 없거나 취소하면 고른 것이 없다', async () => {
  assert.deepEqual(await picker.pickCommunityImages(0), { kind: 'cancelled' });
  assert.equal(state.calls.length, 0);
  state.picked = { canceled: true, assets: [] };
  assert.deepEqual(await picker.pickCommunityImages(5), { kind: 'cancelled' });
});

test('권한을 거절하면 denied, 다시 물을 수 없으면 blocked', async () => {
  state.permission = { granted: false, canAskAgain: true };
  assert.deepEqual(await picker.pickCommunityImages(5), { kind: 'denied' });
  state.permission = { granted: false, canAskAgain: false };
  assert.deepEqual(await picker.pickCommunityImages(5), { kind: 'blocked' });
  assert.equal(state.calls.some(([name]) => name === 'pick'), false);
});

test('한 장을 1600 으로 줄여 upload_headers 와 함께 PUT 하고 끝을 알린 뒤 사진 id 를 돌려준다', async () => {
  assert.equal(await picker.uploadPickedImage('file:///cache/a.jpg'), 'img-1');
  assert.deepEqual(state.calls, [
    ['track', 'file:///cache/a.jpg'],
    ['compress', 'file:///cache/a.jpg', 1600, 1600],
    ['track', 'file:///cache/a.jpg.small.jpg'],
    ['intent', { mime_type: 'image/jpeg', size_bytes: 300_000 }],
    ['put', 'https://s3.test/c', 'file:///cache/a.jpg.small.jpg', 'image/jpeg', { 'Content-Type': 'image/jpeg', 'x-amz-meta-a': '1' }],
    ['complete', 'img-1'],
    ['discard', ['file:///cache/a.jpg.small.jpg']],
  ]);
});

test('PUT 이 끝나지 않으면 끝을 알리지 않고 실패한다', async () => {
  state.upload = 'cancelled';
  await assert.rejects(picker.uploadPickedImage('file:///cache/a.jpg'));
  assert.equal(state.calls.some(([name]) => name === 'complete'), false);
});

test('줄이는 모듈이 없는 빌드는 원본을 올리지 않는다', async () => {
  state.compressor = false;
  await assert.rejects(picker.uploadPickedImage('file:///cache/a.jpg'));
  assert.equal(state.calls.some(([name]) => name === 'intent'), false);
});

test('화면을 닫을 때 기기 복사본만 지우고 서버 주소는 건드리지 않는다', async () => {
  picker.discardPickedImages(['file:///cache/a.jpg', 'https://cdn.test/1.jpg']);
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(state.calls, [['discard', ['file:///cache/a.jpg']]]);
  picker.discardPickedImages(['https://cdn.test/1.jpg']);
  assert.deepEqual(state.calls.length, 1);
});
