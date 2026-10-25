import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { stubModules } from './helpers/stub-modules.mjs';

// 사진 고르기·압축·파일 크기·서버만 바꾸고 줄여 올리는 순서(profile-photo)는 그대로 돈다.
const state = { calls: [], picked: null, compressor: true, sizes: new Map(), upload: 'uploaded' };
globalThis.__photo = state;
globalThis.require = name => {
  if (name !== 'react-native-compressor' || !state.compressor) throw new Error(`Cannot find module '${name}'`);
  return { Image: { compress: async (uri, options) => { state.calls.push(['compress', uri, options.maxWidth]); return 'file:///cache/small.jpg'; } } };
};
stubModules({
  'expo-image-picker': `const s = globalThis.__photo;
    export const launchImageLibraryAsync = async options => { s.calls.push(['pick', options]); return s.picked; };`,
  'expo-file-system/legacy': `const s = globalThis.__photo;
    export const getInfoAsync = async uri => s.sizes.has(uri) ? { exists: true, size: s.sizes.get(uri) } : { exists: false };`,
  '@/lib/account-files': `const s = globalThis.__photo;
    export const trackTemporaryDeviceFile = async uri => { s.calls.push(['track', uri]); };
    export const discardDeviceFiles = async uris => { s.calls.push(['discard', uris]); };`,
  '@/lib/api': `const s = globalThis.__photo;
    export const api = {
      createProfilePhotoIntent: async input => { s.calls.push(['profileIntent', input]); return { upload_url: 'https://s3.test/p', expires_at: 'x' }; },
      completeProfilePhoto: async () => { s.calls.push(['profileComplete']); return { id: 'me', photo_url: 'https://cdn/p.jpg' }; },
      createPortfolioPhotoIntent: async input => { s.calls.push(['portfolioIntent', input]); return { upload_url: 'https://s3.test/f', expires_at: 'x', photo_id: 'ph-1' }; },
      completePortfolioPhoto: async id => { s.calls.push(['portfolioComplete', id]); return { photos: [{ id }] }; },
      startUploadToUrl: (url, uri, type) => { s.calls.push(['put', url, uri, type]); return { result: Promise.resolve({ kind: s.upload }) }; },
      deleteProfilePhoto: async () => { s.calls.push(['deletePhoto']); },
      me: async () => ({ id: 'me', photo_url: null }),
    };`,
});

const photo = await import('../lib/profile-photo-upload.ts');
const asset = uri => ({ canceled: false, assets: [{ uri }] });

beforeEach(() => {
  Object.assign(state, { calls: [], picked: asset('file:///cache/picked.jpg'), compressor: true, upload: 'uploaded' });
  state.sizes = new Map([['file:///cache/small.jpg', 210_000]]);
});

test('프로필 사진은 정사각으로 골라 줄인 JPEG 로 올리고 고른·줄인 파일을 지운다', async () => {
  assert.deepEqual(await photo.pickAndUploadProfilePhoto(), { id: 'me', photo_url: 'https://cdn/p.jpg' });
  assert.deepEqual(state.calls, [
    ['pick', { mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 1 }],
    ['track', 'file:///cache/picked.jpg'],
    ['compress', 'file:///cache/picked.jpg', 2048],
    ['track', 'file:///cache/small.jpg'],
    ['profileIntent', { content_type: 'image/jpeg', size_bytes: 210_000 }],
    ['put', 'https://s3.test/p', 'file:///cache/small.jpg', 'image/jpeg'],
    ['profileComplete'],
    ['discard', ['file:///cache/small.jpg', 'file:///cache/picked.jpg']],
  ]);
});

test('포트폴리오 사진은 비율을 그대로 두고 받은 photo_id 로 끝낸다', async () => {
  assert.deepEqual(await photo.pickAndUploadPortfolioPhoto(), { photos: [{ id: 'ph-1' }] });
  assert.deepEqual(state.calls[0], ['pick', { mediaTypes: ['images'], allowsEditing: false, quality: 1 }]);
  assert.deepEqual(state.calls.find(([name]) => name === 'portfolioComplete'), ['portfolioComplete', 'ph-1']);
});

test('고르기를 취소하면 아무것도 올리지 않는다', async () => {
  state.picked = { canceled: true, assets: [] };
  assert.equal(await photo.pickAndUploadProfilePhoto(), null);
  state.picked = { canceled: false, assets: [] };
  assert.equal(await photo.pickAndUploadProfilePhoto(), null);
  assert.equal(state.calls.filter(([name]) => name !== 'pick').length, 0);
});

test('줄이는 모듈이 없는 빌드는 원본을 올리지 않고 고른 복사본을 지운다', async () => {
  state.compressor = false;
  await assert.rejects(photo.pickAndUploadProfilePhoto(), { message: '이 빌드에서는 사진을 올릴 수 없어요.' });
  assert.deepEqual(state.calls.slice(1), [['discard', ['file:///cache/picked.jpg']]]);
});

test('올리기가 끝까지 가지 않으면 실패를 알린다', async () => {
  state.upload = 'cancelled';
  await assert.rejects(photo.pickAndUploadProfilePhoto(), { message: '사진을 올리지 못했어요. 잠시 후 다시 시도해 주세요.' });
  assert.ok(!state.calls.some(([name]) => name === 'profileComplete'));
});

test('줄인 파일 크기를 못 읽으면 올리지 않는다', async () => {
  state.sizes.clear();
  await assert.rejects(photo.pickAndUploadProfilePhoto(), { message: '사진 파일을 읽지 못했어요.' });
});

test('프로필 사진을 지우고 바뀐 내 계정을 돌려준다', async () => {
  assert.deepEqual(await photo.removeProfilePhoto(), { id: 'me', photo_url: null });
  assert.deepEqual(state.calls, [['deletePhoto']]);
});
