import assert from 'node:assert/strict';
import test from 'node:test';

import { COMMUNITY_IMAGE_COMPRESSION, uploadCommunityImage } from '../lib/community-image.ts';

/** 게시판 사진 한 장 올리기(SOMA-873) — 포트폴리오 사진과 같은 순서: 줄이기 → 주소 → PUT → 끝 알리기. */
function deps(over = {}) {
  const log = [];
  const d = {
    compress: async (uri, options) => {
      log.push(['compress', uri, options]);
      return 'file:///small.jpg';
    },
    trackTemporary: async (uri) => {
      log.push(['track', uri]);
    },
    discard: async (uris) => {
      log.push(['discard', uris]);
    },
    sizeOf: async (uri) => {
      log.push(['size', uri]);
      return 4321;
    },
    createIntent: async (input) => {
      log.push(['intent', input]);
      return { image_id: 'img-1', upload_url: 'https://storage/put', upload_headers: { 'x-amz-acl': 'private' }, expires_at: '2026-11-02T10:00:00Z' };
    },
    put: async (url, uri, headers) => {
      log.push(['put', url, uri, headers]);
    },
    complete: async (imageId) => {
      log.push(['complete', imageId]);
    },
    ...over,
  };
  return { d, log };
}

test('긴 변 1600 JPEG 로 줄여 올리고 upload_headers 를 붙여 PUT 한 뒤 끝을 알린다', async () => {
  const { d, log } = deps();
  assert.equal(await uploadCommunityImage('file:///picked.jpg', d), 'img-1');
  assert.equal(COMMUNITY_IMAGE_COMPRESSION.maxWidth, 1600);
  assert.equal(COMMUNITY_IMAGE_COMPRESSION.maxHeight, 1600);
  assert.equal(COMMUNITY_IMAGE_COMPRESSION.output, 'jpg');
  assert.deepEqual(
    log.map((l) => l[0]),
    ['track', 'compress', 'track', 'size', 'intent', 'put', 'complete', 'discard'],
  );
  assert.deepEqual(log.find((l) => l[0] === 'intent')[1], { mime_type: 'image/jpeg', size_bytes: 4321 });
  assert.deepEqual(log.find((l) => l[0] === 'put').slice(1), [
    'https://storage/put',
    'file:///small.jpg',
    { 'Content-Type': 'image/jpeg', 'x-amz-acl': 'private' },
  ]);
  // 줄인 파일만 지운다 — 고른 원본은 썸네일로 쓰고 화면을 닫을 때 지운다.
  assert.deepEqual(log.find((l) => l[0] === 'discard')[1], ['file:///small.jpg']);
});

test('올리기가 실패해도 줄인 파일은 지우고 오류를 던진다', async () => {
  const { d, log } = deps({
    put: async () => {
      throw new Error('put failed');
    },
  });
  await assert.rejects(uploadCommunityImage('file:///picked.jpg', d), /put failed/);
  assert.deepEqual(log.at(-1), ['discard', ['file:///small.jpg']]);
  assert.equal(log.some((l) => l[0] === 'complete'), false);
});

test('크기를 못 읽으면 주소를 받지 않는다', async () => {
  const { d, log } = deps({ sizeOf: async () => null });
  await assert.rejects(uploadCommunityImage('file:///picked.jpg', d));
  assert.equal(log.some((l) => l[0] === 'intent'), false);
});
