import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildEntryBody,
  canGoPublic,
  canSubmitEntry,
  captionTooLong,
  doneCopy,
  entryAttemptFor,
  entryFailure,
  entryFingerprint,
  videoTooLong,
} from '../lib/challenge/entry.ts';
import { CAPTION_MAX, ENTRY_VIDEO_MAX_SEC } from '../lib/challenge/types.ts';

const apiError = (status, code) => Object.assign(new Error(code ?? String(status)), { status, code });

test('challenge.entry: 보관함 영상으로 공개 참여하면 영상·캡션·공개 범위가 실린다', () => {
  const body = buildEntryBody({ requestId: 'req-1', videoId: 'video-1', caption: '  마지막 시선  ', visibility: 'public' });

  assert.deepEqual(body, {
    request_id: 'req-1',
    video_id: 'video-1',
    caption: '마지막 시선',
    visibility: 'public',
  });
});

test('challenge.entry: 공개 범위를 고르지 않으면 올리기 버튼이 켜지지 않는다', () => {
  assert.equal(canSubmitEntry({ videoId: 'video-1', visibility: null, caption: '' }), false);
  assert.equal(canSubmitEntry({ videoId: 'video-1', visibility: 'public', caption: '' }), true);
  assert.equal(canSubmitEntry({ videoId: 'video-1', visibility: 'private', caption: '' }), true);
  // 영상이 아직 확정되지 않았으면 올릴 수 없다.
  assert.equal(canSubmitEntry({ videoId: null, visibility: 'public', caption: '' }), false);
});

test('challenge.entry: 캡션 300자는 보내고 301자는 화면이 먼저 막는다', () => {
  assert.equal(CAPTION_MAX, 300);
  assert.equal(captionTooLong('가'.repeat(CAPTION_MAX)), false);
  assert.equal(captionTooLong('가'.repeat(CAPTION_MAX + 1)), true);
  assert.equal(canSubmitEntry({ videoId: 'v', visibility: 'public', caption: '가'.repeat(CAPTION_MAX + 1) }), false);
  // 캡션은 선택이라 비우면 싣지 않는다.
  assert.equal('caption' in buildEntryBody({ requestId: 'r', videoId: 'v', caption: '   ', visibility: 'public' }), false);
});

test('challenge.entry: 60초는 되고 61초는 화면이 먼저 막는다', () => {
  assert.equal(ENTRY_VIDEO_MAX_SEC, 60);
  assert.equal(videoTooLong(60_000), false);
  assert.equal(videoTooLong(61_000), true);
  // 길이를 모르면 서버가 본다.
  assert.equal(videoTooLong(null), false);
});

test('challenge.entry: 같은 시도의 재전송은 같은 요청 id 다 — 참여작은 하나다', () => {
  let n = 0;
  const makeId = () => `req-${(n += 1)}`;
  const body = buildEntryBody({ requestId: 'ignored', videoId: 'video-1', caption: '한 줄', visibility: 'public' });

  const first = entryAttemptFor(null, entryFingerprint(body), makeId);
  const again = entryAttemptFor(first, entryFingerprint(body), makeId);
  assert.deepEqual(again, first);
  assert.equal(n, 1);

  // 공개 범위를 바꿔 다시 보내면 새 요청 id 다.
  const changed = buildEntryBody({ requestId: 'ignored', videoId: 'video-1', caption: '한 줄', visibility: 'private' });
  assert.notEqual(entryAttemptFor(again, entryFingerprint(changed), makeId).requestId, first.requestId);
});

test('challenge.entry: 종료·중복·길이·한도·미확정 영상을 갈라 본다', () => {
  assert.deepEqual(entryFailure(apiError(422, 'challenge_closed')), { kind: 'closed' });
  assert.deepEqual(entryFailure(apiError(422, 'duplicate_entry')), { kind: 'duplicate' });
  assert.deepEqual(entryFailure(apiError(422, 'video_too_long')), { kind: 'too_long' });
  assert.deepEqual(entryFailure(apiError(422, 'video_not_ready')), { kind: 'video_not_ready' });
  assert.deepEqual(entryFailure(apiError(429, 'daily_entry_limit')), { kind: 'daily_limit' });
  assert.deepEqual(entryFailure(apiError(422, 'entry_hidden')), { kind: 'entry_hidden' });
  // 남의 영상·없는 영상·검토 중 챌린지는 모두 404 다.
  assert.deepEqual(entryFailure(apiError(404)), { kind: 'not_found' });
});

test('challenge.entry: 완료 문구는 공개와 비공개가 다르다', () => {
  const open = doneCopy('public');
  const closed = doneCopy('private');

  assert.match(open.title, /무대에 올렸어요/);
  assert.match(closed.title, /비공개로 저장했어요/);
  assert.notEqual(open.body, closed.body);
});

test('challenge.entry: 다시 공개는 진행 중·정상·파일이 남아 있을 때만 된다', () => {
  assert.equal(canGoPublic({ status: 'visible', challengeEnded: false, videoPurged: false }), true);
  // 종료 뒤·신고 숨김·파일 파기 뒤에는 되돌릴 수 없다.
  assert.equal(canGoPublic({ status: 'visible', challengeEnded: true, videoPurged: false }), false);
  assert.equal(canGoPublic({ status: 'hidden_by_report', challengeEnded: false, videoPurged: false }), false);
  assert.equal(canGoPublic({ status: 'visible', challengeEnded: false, videoPurged: true }), false);
});
