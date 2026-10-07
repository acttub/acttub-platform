import type { EntryFailure } from './entry.ts';
import type { EntryVisibility } from './types.ts';

/**
 * 챌린지 참여 깔때기 이벤트(SOMA-616).
 *
 * `challenge_perform_tap`(참여하기) 과 `challenge_entry_created`(제출 성공) 사이를 단계별로 나눠
 * 배우가 어디서 멈추는지 GA4 에서 본다. 이름·값은 GA4 규칙(snake_case, 40자 이내)이고,
 * 파라미터에는 챌린지·영상 id 나 캡션 같은 개인·콘텐츠 정보를 넣지 않는다 — 단계와 결과만 보낸다.
 *
 * 단계 순서:
 * 1. challenge_permission_result — 카메라·마이크 권한 결과(허용/거부, 팝업을 띄웠는지)
 * 2. challenge_video_source      — 촬영 또는 갤러리 선택의 결과(선택/취소/실패)
 * 3. challenge_upload_started → challenge_upload_succeeded | challenge_upload_failed
 * 4. challenge_visibility_selected — 공개 범위 선택(공개/비공개)
 * 5. challenge_entry_created(기존) | challenge_submit_failed(사유)
 */
export const CHALLENGE_FUNNEL_EVENTS = {
  permissionResult: 'challenge_permission_result',
  videoSource: 'challenge_video_source',
  uploadStarted: 'challenge_upload_started',
  uploadSucceeded: 'challenge_upload_succeeded',
  uploadFailed: 'challenge_upload_failed',
  visibilitySelected: 'challenge_visibility_selected',
  submitFailed: 'challenge_submit_failed',
} as const;

type PermissionLike = { granted: boolean } | null | undefined;
type EventParams = Record<string, string>;

/** 권한 결과. prompted=false 면 이미 허용돼 있어 팝업 없이 들어온 경우다. */
export function permissionResultParams(camera: PermissionLike, microphone: PermissionLike, prompted: boolean): EventParams {
  return {
    camera: camera?.granted ? 'granted' : 'denied',
    microphone: microphone?.granted ? 'granted' : 'denied',
    prompted: prompted ? 'yes' : 'no',
  };
}

export type VideoSource = 'camera' | 'gallery';
export type VideoSourceResult = 'selected' | 'cancelled' | 'failed';

export function videoSourceParams(source: VideoSource, result: VideoSourceResult): EventParams {
  return { source, result };
}

/** new = 방금 찍거나 갤러리에서 고른 영상을 올림, library = 보관함의 이미 올라간 영상을 고름. */
export type UploadOrigin = 'new' | 'library';

export function uploadParams(origin: UploadOrigin): EventParams {
  return { origin };
}

export type UploadFailureReason = 'video_too_long' | 'video_empty' | 'still_uploading';

export function uploadFailedParams(reason: UploadFailureReason): EventParams {
  return { reason };
}

export function visibilityParams(visibility: EntryVisibility): EventParams {
  return { visibility };
}

/** 제출 실패 사유는 화면 안내와 같은 분류(entryFailure)를 그대로 쓴다. */
export function submitFailedParams(failure: EntryFailure): EventParams {
  return { reason: failure.kind };
}
