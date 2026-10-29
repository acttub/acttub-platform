import { errorCode, errorStatus, isOfflineError } from '../api-request.ts';
import { translate } from '../i18n.ts';
import { getAppConfig } from '../app-config.ts';
import {
  CAPTION_MAX,
  type CreateEntryBody,
  type EntryVisibility,
} from './types.ts';

/**
 * 챌린지 참여(challenge.entry) — 보관함 영상이나 새로 찍은 영상에 캡션을 붙여 공개로 올리거나
 * 비공개로 저장한다.
 *
 * 공개 범위는 올리기 화면에서 **명시적으로** 고른다(미리 선택 없음) — 고르기 전에는 버튼이
 * 켜지지 않는다. 공개로 올릴 때는 다른 참여자의 AI 리포트 비교에 쓰일 수 있다는 것을 한 줄
 * 알린다. 같은 시도의 재전송은 같은 요청 id 라 참여작이 하나다.
 */
function codePoints(value: string): number {
  return [...value].length;
}

export function captionTooLong(caption: string): boolean {
  return codePoints(caption.trim()) > CAPTION_MAX;
}

/** 촬영·영상 길이 상한(기본 60초, 서버 설정 — SOMA-939). 서버가 실제 길이를 다시 본다. */
export function videoTooLong(durationMs: number | null): boolean {
  return durationMs !== null && durationMs > getAppConfig().challenge.entryMaxSeconds * 1000;
}

/** 너무 짧은 영상(0.2초 같은 것)은 재생이 안 되어 참여작으로 올리지 않는다. 길이를 모르면 막지 않는다. */
export function videoTooShort(durationMs: number | null): boolean {
  return durationMs !== null && durationMs < getAppConfig().challenge.entryMinSeconds * 1000;
}

/** 댓글을 쓰거나 지운 뒤 카드의 댓글 수. 0 아래로 내려가지 않는다. */
export function commentCountAfter(count: number, delta: number): number {
  return Math.max(0, count + delta);
}

/** 프로필의 챌린지 수 — 내 삭제되지 않은 참여작(비공개 포함)이 걸린 서로 다른 챌린지 수. 같은 챌린지에 여러 번 올려도 1이다. */
export function participatedChallengeCount(entries: ReadonlyArray<{ challenge: { id: string } }>): number {
  return new Set(entries.map((e) => e.challenge.id)).size;
}

/** 올릴 수 있는 상태인지 — 확정된 영상과 고른 공개 범위가 있어야 한다. */
export function canSubmitEntry(input: {
  videoId: string | null;
  visibility: EntryVisibility | null;
  caption: string;
}): boolean {
  return Boolean(input.videoId) && input.visibility !== null && !captionTooLong(input.caption);
}

export function buildEntryBody(input: {
  requestId: string;
  videoId: string;
  caption: string;
  visibility: EntryVisibility;
  /** 공개일 때만 실린다 — 비공개로 바꾸면 토글이 숨으므로 켜 둔 값이 따라가지 않는다. */
  faceMosaic?: boolean;
}): CreateEntryBody {
  const body: CreateEntryBody = {
    request_id: input.requestId,
    video_id: input.videoId,
    visibility: input.visibility,
  };
  if (input.faceMosaic && input.visibility === 'public') body.face_mosaic = true;
  const caption = input.caption.trim();
  if (caption) body.caption = caption;
  return body;
}

export type EntryAttempt = { requestId: string; fingerprint: string };

export function entryFingerprint(body: CreateEntryBody): string {
  // 모자이크를 켠 요청만 지문에 더한다 — 이 필드 전에 만든 지문과 글자가 같다.
  const parts: string[] = [body.video_id, body.caption ?? '', body.visibility];
  if (body.face_mosaic) parts.push('face_mosaic');
  return JSON.stringify(parts);
}

export function entryAttemptFor(
  previous: EntryAttempt | null,
  fingerprint: string,
  makeId: () => string,
): EntryAttempt {
  if (previous && previous.fingerprint === fingerprint) return previous;
  return { requestId: makeId(), fingerprint };
}

export type EntryFailure =
  /** 종료된 챌린지에는 새로 참여하지 못한다. 영상은 보관함에 남는다. */
  | { kind: 'closed' }
  /** 같은 영상으로 같은 챌린지에 이미 참여했다. */
  | { kind: 'duplicate' }
  /** 미확정이거나 파일만 파기한 본인 영상. */
  | { kind: 'video_not_ready' }
  | { kind: 'too_long' }
  | { kind: 'daily_limit' }
  | { kind: 'fingerprint_mismatch' }
  /** 신고로 숨겨진 참여작은 작성자가 다시 공개할 수 없다. */
  | { kind: 'entry_hidden' }
  /** 없는 챌린지·영상, 남의 영상, review·hidden 챌린지. */
  | { kind: 'not_found' }
  | { kind: 'offline' }
  | { kind: 'other' };

export function entryFailure(error: unknown): EntryFailure {
  const code = errorCode(error);
  const status = errorStatus(error);
  if (code === 'challenge_closed') return { kind: 'closed' };
  if (code === 'duplicate_entry') return { kind: 'duplicate' };
  if (code === 'video_not_ready') return { kind: 'video_not_ready' };
  if (code === 'video_too_long') return { kind: 'too_long' };
  if (code === 'daily_entry_limit' || status === 429) return { kind: 'daily_limit' };
  if (code === 'request_fingerprint_mismatch') return { kind: 'fingerprint_mismatch' };
  if (code === 'entry_hidden') return { kind: 'entry_hidden' };
  if (status === 404) return { kind: 'not_found' };
  if (isOfflineError(error)) return { kind: 'offline' };
  return { kind: 'other' };
}

export function entryFailureMessage(failure: EntryFailure): string {
  switch (failure.kind) {
    case 'closed':
      return translate('challengeUpload.errClosed');
    case 'duplicate':
      return translate('challengeUpload.errDuplicate');
    case 'video_not_ready':
      return translate('challengeUpload.errVideoNotReady');
    case 'too_long':
      return translate('challengeUpload.errTooLong');
    case 'daily_limit':
      return translate('challengeUpload.errDailyLimit');
    case 'entry_hidden':
      return translate('challengeUpload.errHidden');
    case 'fingerprint_mismatch':
      return translate('challengeUpload.errInvalid');
    case 'not_found':
      return translate('challenges.notFound');
    case 'offline':
      return translate('challenges.offline');
    default:
      return translate('challengeUpload.errOther');
  }
}

/** 완료 화면(A18.3) 문구 — 공개와 비공개가 다르다. */
export function doneCopy(visibility: EntryVisibility): { title: string; body: string } {
  return visibility === 'public'
    ? { title: translate('challengeUpload.doneTitle'), body: translate('challengeUpload.doneSub') }
    : { title: translate('challengeUpload.doneTitlePrivate'), body: translate('challengeUpload.doneSubPrivate') };
}

/**
 * 얼굴 모자이크 상태를 본인에게 알리는 한 줄(SOMA-809). 모자이크를 끈 참여작이나 준비된 것은 알릴 것이 없다.
 * 만드는 중·실패는 다른 사람에게 아직 보이지 않는다는 뜻이다.
 */
export function mosaicNotice(entry: {
  face_mosaic?: boolean;
  mosaic_status?: string | null;
}): 'pending' | 'failed' | null {
  if (!entry.face_mosaic) return null;
  if (entry.mosaic_status === 'pending') return 'pending';
  if (entry.mosaic_status === 'failed') return 'failed';
  return null;
}

/**
 * 다시 공개할 수 있는지 — 진행 중 챌린지의 정상 참여작이고 영상 파일이 남아 있을 때만이다.
 * 비공개 전환은 언제든 된다. 운영 숨김은 작성자가 풀 수 없다.
 */
export function canGoPublic(input: {
  status: string;
  challengeEnded: boolean;
  videoPurged: boolean;
}): boolean {
  return input.status === 'visible' && !input.challengeEnded && !input.videoPurged;
}

/** 삭제 안내 — 영상은 보관함에 남는다. */
export function deleteNotice(): string {
  return translate('challengeUpload.deleteNotice');
}
