import assert from 'node:assert/strict';
import test from 'node:test';

import { parseEntryLink, entryShareUrl } from '../lib/challenge/deeplink.ts';
import {
  REPORT_REASONS,
  blockedLabel,
  buildReportBody,
  canBlock,
  canSendReport,
  needsNote,
  noteTooLong,
  removeAuthored,
  reportDoneMessage,
  reportFailure,
} from '../lib/challenge/moderation.ts';
import { REPORT_NOTE_MAX } from '../lib/challenge/types.ts';

const apiError = (status, code) => Object.assign(new Error(code ?? String(status)), { status, code });

test('challenge.report: 사유는 다섯이고 기타를 고르면 메모를 받는다', () => {
  assert.deepEqual([...REPORT_REASONS], ['copyright', 'inappropriate', 'spam', 'duplicate', 'other']);
  assert.equal(needsNote('other'), true);
  assert.equal(needsNote('spam'), false);
  // 사유를 고르기 전에는 보낼 수 없다.
  assert.equal(canSendReport({ reason: null, note: '' }), false);
  assert.equal(canSendReport({ reason: 'spam', note: '' }), true);
});

test('challenge.report: 메모는 200자까지이고 넘치면 화면이 먼저 막는다', () => {
  assert.equal(REPORT_NOTE_MAX, 200);
  assert.equal(noteTooLong('가'.repeat(REPORT_NOTE_MAX)), false);
  assert.equal(noteTooLong('가'.repeat(REPORT_NOTE_MAX + 1)), true);
  assert.equal(canSendReport({ reason: 'other', note: '가'.repeat(REPORT_NOTE_MAX + 1) }), false);
});

test('challenge.report: 참여작·댓글·챌린지를 대상으로 접수한다', () => {
  const body = buildReportBody({
    requestId: 'req-1',
    target: 'comment',
    targetId: 'comment-1',
    reason: 'inappropriate',
    note: '  괴롭힘  ',
  });

  assert.deepEqual(body, {
    request_id: 'req-1',
    target_type: 'comment',
    target_id: 'comment-1',
    reason: 'inappropriate',
    note: '괴롭힘',
  });
  // 메모가 없으면 싣지 않는다.
  assert.equal('note' in buildReportBody({ requestId: 'r', target: 'entry', targetId: 'e', reason: 'spam', note: '' }), false);
  // 참여작·댓글은 바로 숨겨지고 챌린지는 운영이 본다 — 안내가 다르다.
  assert.notEqual(reportDoneMessage('challenge'), reportDoneMessage('entry'));
});

test('challenge.report: 본인 신고·하루 한도·볼 수 없는 대상을 갈라 본다', () => {
  assert.deepEqual(reportFailure(apiError(422, 'self_report')), { kind: 'self' });
  assert.deepEqual(reportFailure(apiError(429, 'daily_report_limit')), { kind: 'daily_limit' });
  assert.deepEqual(reportFailure(apiError(404)), { kind: 'not_found' });
  assert.deepEqual(reportFailure(apiError(422)), { kind: 'invalid' });
});

test('challenge.block: 자기 자신은 차단할 수 없고 차단하면 그 사람의 것이 바로 사라진다', () => {
  assert.equal(canBlock({ authorId: 'user-2', myId: 'user-1' }), true);
  assert.equal(canBlock({ authorId: 'user-1', myId: 'user-1' }), false);
  assert.equal(canBlock({ authorId: null, myId: 'user-1' }), false);

  const items = [
    { id: 'a', author: { user_id: 'user-2' } },
    { id: 'b', author: { user_id: 'user-3' } },
    { id: 'c', author: { user_id: 'user-2' } },
  ];
  assert.deepEqual(removeAuthored(items, 'user-2').map((i) => i.id), ['b']);
});

test('challenge.block: 차단 목록은 이름으로 보이고 이름이 없으면 탈퇴한 사용자다', () => {
  assert.equal(blockedLabel({ name: '윤서' }), '윤서');
  assert.equal(blockedLabel({ name: '  ' }), '탈퇴한 사용자');
});

test('challenge.react: 공유 링크는 참여작 딥링크이고 앱에서 그 참여작을 연다', () => {
  const url = entryShareUrl('entry-1');
  assert.match(url, /entry-1/);

  assert.deepEqual(parseEntryLink(url), { entryId: 'entry-1' });
  assert.deepEqual(parseEntryLink('actingapp://entry/entry-2'), { entryId: 'entry-2' });
  assert.deepEqual(parseEntryLink('https://www.acttub.com/e/entry-3?utm=x'), { entryId: 'entry-3' });
  // 우리 주소가 아니면 열지 않는다.
  assert.equal(parseEntryLink('https://example.com/e/entry-4'), null);
  assert.equal(parseEntryLink(''), null);
});
