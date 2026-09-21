/**
 * 영상 보관함(practice.record · practice.library)의 서버 계약 타입. 경로·필드는 `.scratch/SOMA-546-practice-spec.md`
 * API 표(2차 검토 반영)를 따른 계획안이고 웹 임시 타입(apps/web/src/lib/practice/api-types.ts)과 같은 모양이다.
 * api 갈래(PA1)가 계약을 굳히면 여기를 맞춘다.
 */
export type VideoUsage = {
  /** 이 영상을 쓰는 회차 수 */
  practice_count: number;
  /** 이 영상을 쓰는 챌린지 참여작 수 */
  entry_count: number;
};

export type Video = {
  id: string;
  duration_ms: number;
  byte_size: number;
  content_type: string;
  favorite: boolean;
  /** "파일만 파기"한 시각. 있으면 객체·받아쓰기가 없고 재생할 수 없다. */
  purged_at: string | null;
  created_at: string;
  usage: VideoUsage;
  /** 10분 서명 재생 주소. 목록에는 없고 상세에만 온다. */
  playback_url: string | null;
  playback_expires_at: string | null;
};

export type VideoFilter = 'all' | 'recent7' | 'favorite';

export type VideoListResponse = { videos: Video[]; next_cursor: string | null };

/** POST /v2/videos/intents */
export type VideoIntentRequest = { request_id: string; content_type: string; byte_size: number; duration_ms: number };
export type VideoIntentResponse = { intent_id: string; upload_url: string; expires_at: string };

export const VIDEO_ERROR_CODES = [
  'video_too_large',
  'video_too_long',
  'video_quota',
  'video_not_ready',
  'video_in_use',
  'upload_expired',
  'request_fingerprint_mismatch',
] as const;
export type VideoErrorCode = (typeof VIDEO_ERROR_CODES)[number];
