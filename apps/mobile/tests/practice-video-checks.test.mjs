import assert from 'node:assert/strict';
import test from 'node:test';

import { ApiError } from '../lib/api-request.ts';
import { VIDEO_MAX_BYTES, VIDEO_MAX_MS, checkVideoForUpload, videoErrorCodeOf, videoErrorMessage } from '../lib/library/video-checks.ts';

test('practice.record: 압축 결과 100MiB + 1바이트는 올리지 않고 "너무 커요", 5분 1초는 "너무 길어요"', () => {
  assert.equal(VIDEO_MAX_BYTES, 100 * 1024 * 1024);
  assert.equal(VIDEO_MAX_MS, 300_000);
  assert.deepEqual(checkVideoForUpload({ byteSize: VIDEO_MAX_BYTES + 1, durationMs: 1_000 }), { ok: false, code: 'video_too_large' });
  assert.deepEqual(checkVideoForUpload({ byteSize: 1_000, durationMs: 301_000 }), { ok: false, code: 'video_too_long' });
  assert.deepEqual(checkVideoForUpload({ byteSize: VIDEO_MAX_BYTES, durationMs: 300_000 }), { ok: true });
  assert.deepEqual(checkVideoForUpload({ byteSize: 0, durationMs: 1_000 }), { ok: false, code: 'video_empty' });
  assert.match(videoErrorMessage('video_too_large'), /100MB/);
  assert.match(videoErrorMessage('video_too_long'), /5분/);
});

test('practice.record: 총량 초과(422 video_quota)는 보관함 정리(삭제 또는 파일만 파기)로 안내한다', () => {
  const error = new ApiError(422, 'x', 'video_quota', 'video_quota', { detail: 'video_quota' });
  assert.equal(videoErrorCodeOf(error), 'video_quota');
  assert.match(videoErrorMessage(error), /파일만 파기/);
  assert.equal(videoErrorCodeOf(new ApiError(422, 'x', 'upload_expired', 'upload_expired')), 'upload_expired');
  assert.equal(videoErrorCodeOf(new Error('boom')), null);
});
