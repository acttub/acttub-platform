import assert from 'node:assert/strict';
import test from 'node:test';

import { REPORT_REASONS, blockableUserId, reportPayload } from '../lib/moderation.ts';

test('신고 사유는 서버 enum 다섯 가지를 그대로 쓴다', () => {
  assert.deepEqual(
    REPORT_REASONS.map((r) => r.value),
    ['spam', 'abuse', 'sexual', 'privacy', 'other'],
  );
  for (const r of REPORT_REASONS) assert.ok(r.label.length > 0);
});

test('익명 글은 차단할 수 없다 — id가 있어도', () => {
  assert.equal(blockableUserId({ id: 'u1' }, { anonymous: true }), null);
});

test('내 글은 차단 대상이 아니다', () => {
  assert.equal(blockableUserId({ id: 'u1' }, { anonymous: false, mine: true }), null);
});

test('남의 실명 글이면 작성자 id를 돌려준다', () => {
  assert.equal(blockableUserId({ id: 'u1' }, { anonymous: false }), 'u1');
  assert.equal(blockableUserId({}, { anonymous: false }), null);
  assert.equal(blockableUserId(null, { anonymous: false }), null);
});

test('신고 본문은 서버 스네이크 케이스로, 덧말은 다듬어서 싣는다', () => {
  assert.deepEqual(
    reportPayload({ targetType: 'post', targetId: 'p1', reason: 'spam' }),
    { target_type: 'post', target_id: 'p1', reason: 'spam', detail: null },
  );
  assert.deepEqual(
    reportPayload({ targetType: 'comment', targetId: 'c1', reason: 'other', detail: '  욕설이요  ' }),
    { target_type: 'comment', target_id: 'c1', reason: 'other', detail: '욕설이요' },
  );
  const long = 'a'.repeat(600);
  assert.equal(
    reportPayload({ targetType: 'post', targetId: 'p1', reason: 'abuse', detail: long }).detail
      ?.length,
    500,
  );
});
