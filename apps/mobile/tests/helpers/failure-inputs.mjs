import { ApiError, NetworkError, RequestAbortError } from '../../lib/api-request.ts';
import { browseFailure, browseFailureMessage } from '../../lib/challenge/browse.ts';
import { reportRequestFailure, reportRequestFailureMessage } from '../../lib/challenge/ai-report.ts';
import { createFailure, createFailureMessage } from '../../lib/challenge/create.ts';
import { entryFailure, entryFailureMessage } from '../../lib/challenge/entry.ts';
import { blockFailureMessage, reportFailure, reportFailureMessage } from '../../lib/challenge/moderation.ts';
import { reactFailure, reactFailureMessage } from '../../lib/challenge/react.ts';
import { coachFailure, coachFailureMessage } from '../../lib/practice/coach.ts';
import { startFailure } from '../../lib/practice/start.ts';

// 서버·기기가 낼 수 있는 오류 모양 — 상태만, 코드만, 둘 다, 모양이 틀린 것, 요청 계층의 오류 클래스.
const CODES = [
  'self_report', 'daily_report_limit', 'self_block', 'duplicate_challenge', 'invalid_duration', 'daily_challenge_limit',
  'request_fingerprint_mismatch', 'member_only', 'cursor_expired', 'challenge_closed', 'duplicate_entry', 'video_not_ready',
  'video_too_long', 'daily_entry_limit', 'entry_hidden', 'daily_report_request_limit', 'self_like', 'self_save',
  'daily_comment_limit', 'conversation_conflict', 'conversation_closed', 'analysis_not_ready', 'practice_in_progress',
  'guest_daily_analysis_limit',
];
export const FAILURE_INPUTS = {
  null: null,
  string: 'boom',
  empty: {},
  ...Object.fromEntries([400, 403, 404, 409, 410, 422, 429, 499, 500, 503, 599, 600].map(s => [`status ${s}`, { status: s }])),
  'status "404"': { status: '404' },
  'code 5 · status 400': { code: 5, status: 400 },
  'name NetworkError · status 400': { name: 'NetworkError', status: 400 },
  NetworkError: new NetworkError('끊김'),
  'RequestAbortError timeout': new RequestAbortError('timeout'),
  'ApiError 404': new ApiError(404, 'm', 'not_found'),
  'ApiError 502': new ApiError(502, 'm', 'unknown_error'),
  ...Object.fromEntries(CODES.map(c => [`${c} · 400`, { code: c, status: 400 }])),
  ...Object.fromEntries(CODES.map(c => [`${c} · 없음`, { code: c }])),
};

// 분류 → 화면 문구까지 한 번에 본다. 문구 함수가 없는 것(startFailure)은 분류만, blockFailureMessage 는 문구만 낸다.
const pair = (classify, message) => input => {
  const failure = classify(input);
  return { ...failure, message: message(failure) };
};
export const CLASSIFIERS = {
  browseFailure: pair(browseFailure, browseFailureMessage),
  reportRequestFailure: pair(reportRequestFailure, reportRequestFailureMessage),
  createFailure: pair(createFailure, createFailureMessage),
  entryFailure: pair(entryFailure, entryFailureMessage),
  reportFailure: pair(reportFailure, reportFailureMessage),
  blockFailureMessage,
  reactFailure: pair(reactFailure, reactFailureMessage),
  coachFailure: pair(coachFailure, coachFailureMessage),
  startFailure,
};

export function classifyAll() {
  return Object.fromEntries(Object.entries(CLASSIFIERS).map(([name, fn]) => [
    name,
    Object.fromEntries(Object.entries(FAILURE_INPUTS).map(([label, input]) => [label, fn(input)])),
  ]));
}
