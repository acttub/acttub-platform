import { translate } from '../i18n.ts';
import {
  CHALLENGE_DURATIONS,
  CHARACTER_MAX,
  LINE_MAX,
  SCENE_NOTE_MAX,
  WORK_MAX,
  type ChallengeDuration,
  type CreateChallengeBody,
} from './types.ts';

/**
 * 대사 등록(challenge.create) — A16.2 세 단계(대사 → 작품·인물·메모 → 기간)를 한 요청으로 만든다.
 *
 * 글자 수는 코드 포인트로 센다(이모지 하나 = 1자). 같은 시도의 재전송은 같은 요청 id 라 챌린지가
 * 하나이고, 본문을 고치면 새 id 로 간다. 개설한 사람은 자동으로 참여하지 않는다.
 */
function codePoints(value: string): number {
  return [...value].length;
}

export function normalizeChallengeLine(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

export type ChallengeDraft = {
  line: string;
  work: string;
  character: string;
  sceneNote: string;
  durationDays: ChallengeDuration;
};

export const emptyChallengeDraft: ChallengeDraft = {
  line: '',
  work: '',
  character: '',
  sceneNote: '',
  durationDays: 7,
};

/** 단계마다 다음으로 갈 수 있는지. 대사·작품은 필수, 인물·메모는 선택이다. */
export function stepComplete(draft: ChallengeDraft, step: 0 | 1 | 2): boolean {
  if (step === 0) return draft.line.trim().length > 0 && !draftOverflow(draft);
  if (step === 1) return draft.work.trim().length > 0 && !draftOverflow(draft);
  return isDuration(draft.durationDays);
}

export function isDuration(value: number): value is ChallengeDuration {
  return (CHALLENGE_DURATIONS as readonly number[]).includes(value);
}

/** 서버가 422로 막기 전에 화면이 먼저 막는다. 넘친 칸 이름을 돌려준다. */
export function draftOverflow(draft: ChallengeDraft): 'line' | 'work' | 'character' | 'sceneNote' | null {
  if (codePoints(normalizeChallengeLine(draft.line)) > LINE_MAX) return 'line';
  if (codePoints(draft.work.trim()) > WORK_MAX) return 'work';
  if (codePoints(draft.character.trim()) > CHARACTER_MAX) return 'character';
  if (codePoints(draft.sceneNote.trim()) > SCENE_NOTE_MAX) return 'sceneNote';
  return null;
}

export function buildCreateBody(requestId: string, draft: ChallengeDraft): CreateChallengeBody {
  const body: CreateChallengeBody = {
    request_id: requestId,
    line: normalizeChallengeLine(draft.line),
    work: draft.work.trim(),
    duration_days: draft.durationDays,
  };
  const character = draft.character.trim();
  const sceneNote = draft.sceneNote.trim();
  if (character) body.character = character;
  if (sceneNote) body.scene_note = sceneNote;
  return body;
}

export type CreateAttempt = { requestId: string; fingerprint: string };

export function fingerprintOf(body: CreateChallengeBody): string {
  return JSON.stringify([body.line, body.work, body.character ?? '', body.scene_note ?? '', body.duration_days]);
}

/**
 * 이번 시도에 쓸 요청 id. 같은 본문을 다시 보내면(이중 탭·재시도) 같은 id 라 챌린지가 하나이고,
 * 본문을 고쳐 보내면 새 id 다 — 같은 id 에 다른 본문은 422 request_fingerprint_mismatch 다.
 */
export function attemptFor(
  previous: CreateAttempt | null,
  fingerprint: string,
  makeId: () => string,
): CreateAttempt {
  if (previous && previous.fingerprint === fingerprint) return previous;
  return { requestId: makeId(), fingerprint };
}

export type CreateFailure =
  /** 같은 사람이 같은 대사로 진행 중 챌린지를 이미 열었다. */
  | { kind: 'duplicate' }
  /** 기간 선택지 밖 값. */
  | { kind: 'invalid_duration' }
  /** 하루 3개를 다 썼다(한국 시간). */
  | { kind: 'daily_limit' }
  | { kind: 'fingerprint_mismatch' }
  /** 게스트이거나 한국어가 아닌 회원 — 챌린지 자체가 열리지 않는다. */
  | { kind: 'member_only' }
  /** 글자 수·빈 칸 같은 형식 문제. */
  | { kind: 'invalid' }
  | { kind: 'offline' }
  | { kind: 'other' };

function codeOf(error: unknown): string | null {
  if (error === null || typeof error !== 'object') return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

function statusOf(error: unknown): number | null {
  if (error === null || typeof error !== 'object') return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' ? status : null;
}

export function createFailure(error: unknown): CreateFailure {
  const code = codeOf(error);
  const status = statusOf(error);
  if (code === 'duplicate_challenge') return { kind: 'duplicate' };
  if (code === 'invalid_duration') return { kind: 'invalid_duration' };
  if (code === 'daily_challenge_limit' || status === 429) return { kind: 'daily_limit' };
  if (code === 'request_fingerprint_mismatch') return { kind: 'fingerprint_mismatch' };
  if (code === 'member_only' || status === 403) return { kind: 'member_only' };
  if (status === 422) return { kind: 'invalid' };
  const name = error !== null && typeof error === 'object' ? (error as { name?: unknown }).name : null;
  if (name === 'NetworkError' || status === null || (status >= 500 && status <= 599)) return { kind: 'offline' };
  return { kind: 'other' };
}

export function createFailureMessage(failure: CreateFailure): string {
  switch (failure.kind) {
    case 'duplicate':
      return translate('lineNew.errDuplicate');
    case 'invalid_duration':
      return translate('lineNew.errDuration');
    case 'daily_limit':
      return translate('lineNew.errDailyLimit');
    case 'fingerprint_mismatch':
    case 'invalid':
      return translate('lineNew.errInvalid');
    case 'member_only':
      return translate('challenges.memberOnly');
    case 'offline':
      return translate('lineNew.errOffline');
    default:
      return translate('lineNew.errOther');
  }
}
