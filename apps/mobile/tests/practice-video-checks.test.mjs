import assert from 'node:assert/strict';
import test from 'node:test';

import { ApiError } from '../lib/api-request.ts';
import { VIDEO_MAX_BYTES, VIDEO_MAX_MS, checkVideoForUpload, videoErrorCodeOf, videoErrorMessage, videoRejectDialog } from '../lib/library/video-checks.ts';

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

test('practice.record: 총량 초과(422 video_quota)는 저장 공간 정리(삭제 또는 파일만 지우기)로 안내한다', () => {
  const error = new ApiError(422, 'x', 'video_quota', 'video_quota', { detail: 'video_quota' });
  assert.equal(videoErrorCodeOf(error), 'video_quota');
  assert.match(videoErrorMessage(error), /영상 파일만 지우면/);
  assert.equal(videoErrorCodeOf(new ApiError(422, 'x', 'upload_expired', 'upload_expired')), 'upload_expired');
  assert.equal(videoErrorCodeOf(new Error('boom')), null);
});

test('practice.record: 보관함이 받지 않은 영상 알림은 제목이 결과 문장이다', () => {
  assert.deepEqual(videoRejectDialog('video_too_long'), {
    title: '영상이 너무 길어요',
    message: '5분까지 올릴 수 있어요. 더 짧은 영상을 골라 주세요.',
  });
  assert.deepEqual(videoRejectDialog('video_empty'), { title: '영상을 읽지 못했어요', message: '다른 영상을 골라 주세요.' });
});

test('practice.start: 영상 오류 문구에 서버 코드를 보이지 않는다(400 video_not_found·모르는 코드)', () => {
  assert.equal(videoErrorMessage(new ApiError(400, 'video_not_found', 'video_not_found')), '영상을 찾지 못했어요. 영상을 다시 골라 주세요.');
  assert.equal(videoErrorMessage(new ApiError(400, 'weird_code', 'weird_code')), '영상 업로드에 실패했어요. 네트워크를 확인해주세요.');
  assert.equal(videoErrorMessage(new ApiError(503, '연결이 불안정해요.', 'x')), '연결이 불안정해요.');
});
