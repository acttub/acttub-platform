/**
 * 영상 올리기의 기기 검사와 오류 문구(practice.record). 서버도 같은 값을 검사한다(422 video_too_large·video_too_long).
 * 형식은 MP4·MOV, 길이 5분, 서버에 올리는 파일(720px로 줄인 업로드본)은 100MiB 이하다.
 */
import { ApiError, classifyUnprocessable } from '../api-request.ts';
import { translate as t } from '../i18n.ts';
import { VIDEO_ERROR_CODES, type VideoErrorCode } from './types.ts';

export const VIDEO_MAX_BYTES = 100 * 1024 * 1024;
export const VIDEO_MAX_MS = 300_000;

export type VideoCheck = { ok: true } | { ok: false; code: 'video_too_large' | 'video_too_long' | 'video_empty' };

export function checkVideoForUpload(file: { byteSize: number; durationMs: number | null }): VideoCheck {
  if (file.byteSize <= 0) return { ok: false, code: 'video_empty' };
  if (file.byteSize > VIDEO_MAX_BYTES) return { ok: false, code: 'video_too_large' };
  if (file.durationMs !== null && file.durationMs > VIDEO_MAX_MS) return { ok: false, code: 'video_too_long' };
  return { ok: true };
}

export function isVideoErrorCode(code: unknown): code is VideoErrorCode {
  return typeof code === 'string' && (VIDEO_ERROR_CODES as readonly string[]).includes(code);
}

/** 오류(또는 기기 검사의 코드 문자열)에서 사유 코드를 꺼낸다. 아니면 null. */
export function videoErrorCodeOf(error: unknown): VideoErrorCode | null {
  if (isVideoErrorCode(error)) return error;
  const kind = classifyUnprocessable(error);
  return kind?.kind === 'reason' && isVideoErrorCode(kind.code) ? kind.code : null;
}

const MESSAGE_KEY: Record<VideoErrorCode | 'video_empty', string> = {
  video_too_large: 'archive.tooLarge',
  video_too_long: 'archive.tooLong',
  video_quota: 'archive.quota',
  video_not_ready: 'archive.statusPending',
  video_in_use: 'archive.inUseTitle',
  upload_expired: 'archive.uploadExpired',
  request_fingerprint_mismatch: 'archive.uploadExpired',
  video_empty: 'archive.tooLarge',
};

export function videoErrorMessage(error: unknown): string {
  if (error === 'video_empty') return t('errors.uploadFail');
  const code = videoErrorCodeOf(error);
  if (code) return t(MESSAGE_KEY[code]);
  if (error instanceof ApiError) return error.message;
  return error instanceof Error && error.message ? error.message : t('errors.uploadFail');
}
