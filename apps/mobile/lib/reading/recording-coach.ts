/**
 * 리딩 녹음 코치(SOMA-791, 실험·무료) — 서버 `/v2/recording-coaches` 응답 모양과 오류 분류. 스펙: docs/specs/reading/recording-coach.md.
 *
 * 서버 스위치(ACTTUB_RECORDING_COACH_ENABLED)를 끈 배포에는 경로 자체가 없다. 앱은 없는 대화 id 를 한 번 물어
 * `recording_coach_not_found`(켜짐)인지 그냥 Not Found(꺼짐)인지로 카드를 띄울지 정한다 — 모델을 부르지 않는다.
 */
export type RecordingCoachMessage = { role: 'coach' | 'actor'; text: string };
export type RecordingCoach = {
  id: string;
  reading_session_id: string;
  status: 'asked' | 'answered';
  messages: RecordingCoachMessage[];
  video_line: { line_id: string; text: string } | null;
  created_at: string;
  updated_at: string;
};

/** 오류의 사유 코드(ApiError.code). api-request 를 끌어오지 않으려고 모양만 본다. */
function errorCode(error: unknown): string | null {
  if (error === null || typeof error !== 'object') return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

export const RECORDING_COACH_PROBE_ID = '00000000-0000-0000-0000-000000000000';
export const RECORDING_COACH_REPLY_MAX = 1000;

/** 없는 대화를 물었을 때의 오류로 기능이 켜져 있는지 본다. */
export function recordingCoachOnFromProbe(error: unknown): boolean {
  return errorCode(error) === 'recording_coach_not_found';
}

export type RecordingCoachFailure = 'not_enough_audio' | 'unavailable' | 'gone' | 'other';

export function recordingCoachFailure(error: unknown): RecordingCoachFailure {
  const code = errorCode(error);
  if (code === 'recording_coach_not_enough_audio') return 'not_enough_audio';
  if (code === 'recording_coach_unavailable') return 'unavailable';
  if (code === 'session_not_found' || code === 'recording_coach_not_found' || code === 'Not Found') return 'gone';
  return 'other';
}
