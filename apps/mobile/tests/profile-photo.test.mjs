import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PROFILE_PHOTO_COMPRESSION,
  PROFILE_PHOTO_MAX_EDGE,
  uploadProfilePhoto,
} from '../lib/profile-photo.ts';

function fakes(overrides = {}) {
  const calls = [];
  return {
    calls,
    deps: {
      compress: async (uri, options) => {
        calls.push(['compress', uri, options]);
        return 'file:///cache/compressed.jpg';
      },
      sizeOf: async (uri) => {
        calls.push(['sizeOf', uri]);
        return 482_113;
      },
      createIntent: async (input) => {
        calls.push(['intent', input]);
        return { upload_url: 'https://storage.test/put', expires_at: '2026-10-01T00:00:00Z' };
      },
      put: async (url, uri, contentType) => {
        calls.push(['put', url, uri, contentType]);
      },
      complete: async () => {
        calls.push(['complete']);
        return { id: 'user-1', profile: { photo_url: 'https://cdn.test/me.jpg' } };
      },
      ...overrides,
    },
  };
}

test('account.profile: 사진은 올리기 전에 항상 긴 변 2048px의 JPEG로 줄인다', async () => {
  const { calls, deps } = fakes();

  await uploadProfilePhoto('file:///picked/huge-30mb.heic', deps);

  assert.equal(PROFILE_PHOTO_MAX_EDGE, 2048);
  assert.deepEqual(PROFILE_PHOTO_COMPRESSION, {
    compressionMethod: 'manual',
    maxWidth: 2048,
    maxHeight: 2048,
    output: 'jpg',
    quality: 0.85,
  });
  // 줄이기가 첫 단계다. 고른 원본은 어디에도 올라가지 않는다.
  assert.deepEqual(calls[0], ['compress', 'file:///picked/huge-30mb.heic', PROFILE_PHOTO_COMPRESSION]);
  assert.equal(
    calls.some((call) => call[0] !== 'compress' && JSON.stringify(call).includes('huge-30mb')),
    false,
  );
});

test('account.profile: 30MB 사진을 고르면 줄인 파일의 크기와 image/jpeg로 주소를 받아 올리고 저장한다', async () => {
  const { calls, deps } = fakes();

  const me = await uploadProfilePhoto('file:///picked/huge-30mb.heic', deps);

  assert.deepEqual(
    calls.map((call) => call[0]),
    ['compress', 'sizeOf', 'intent', 'put', 'complete'],
  );
  assert.deepEqual(calls[2], ['intent', { content_type: 'image/jpeg', size_bytes: 482_113 }]);
  assert.deepEqual(calls[3], [
    'put',
    'https://storage.test/put',
    'file:///cache/compressed.jpg',
    'image/jpeg',
  ]);
  assert.equal(me.profile.photo_url, 'https://cdn.test/me.jpg');
});

test('account.profile: 올리기가 실패하면 끝났다고 알리지 않는다 — 옛 사진이 그대로 남는다', async () => {
  const { calls, deps } = fakes({
    put: async () => {
      throw new TypeError('offline');
    },
  });

  await assert.rejects(uploadProfilePhoto('file:///picked/photo.jpg', deps));

  assert.equal(calls.some((call) => call[0] === 'complete'), false);
});

test('account.profile: 줄인 파일의 크기를 못 읽으면 주소를 받지 않는다', async () => {
  const { calls, deps } = fakes({ sizeOf: async () => null });

  await assert.rejects(uploadProfilePhoto('file:///picked/photo.jpg', deps));

  assert.equal(calls.some((call) => call[0] === 'intent'), false);
});

test('account.portfolio: 포트폴리오 사진도 올리기 전에 항상 줄이고, 주소를 받을 때 받은 photo_id로 끝을 알린다', async () => {
  const calls = [];
  const portfolio = await uploadProfilePhoto('file:///picked/headshot-30mb.heic', {
    compress: async (uri, options) => {
      calls.push(['compress', uri, options]);
      return 'file:///cache/headshot.jpg';
    },
    sizeOf: async () => 912_044,
    createIntent: async (input) => {
      calls.push(['intent', input]);
      return { photo_id: 'photo-7', upload_url: 'https://storage.test/p7', expires_at: '2026-10-01T00:00:00Z' };
    },
    put: async (url, uri, contentType) => {
      calls.push(['put', url, uri, contentType]);
    },
    complete: async (intent) => {
      calls.push(['complete', intent.photo_id]);
      return { photos: [{ id: 'photo-7', url: 'https://cdn.test/p7.jpg' }] };
    },
  });

  assert.deepEqual(calls[0], ['compress', 'file:///picked/headshot-30mb.heic', PROFILE_PHOTO_COMPRESSION]);
  assert.deepEqual(calls[1], ['intent', { content_type: 'image/jpeg', size_bytes: 912_044 }]);
  assert.deepEqual(calls[2], ['put', 'https://storage.test/p7', 'file:///cache/headshot.jpg', 'image/jpeg']);
  assert.deepEqual(calls[3], ['complete', 'photo-7']);
  assert.equal(portfolio.photos[0].id, 'photo-7');
});

test('account.portfolio: 열한 번째 사진이라 주소를 못 받으면 아무것도 올리지 않는다', async () => {
  const calls = [];
  await assert.rejects(
    uploadProfilePhoto('file:///picked/eleventh.jpg', {
      compress: async () => 'file:///cache/eleventh.jpg',
      sizeOf: async () => 1000,
      createIntent: async () => {
        throw Object.assign(new Error('limit'), { status: 422, code: 'portfolio_photo_limit_exceeded' });
      },
      put: async () => void calls.push('put'),
      complete: async () => void calls.push('complete'),
    }),
    (error) => error.code === 'portfolio_photo_limit_exceeded',
  );
  assert.deepEqual(calls, []);
});
