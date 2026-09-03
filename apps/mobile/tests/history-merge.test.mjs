import assert from 'node:assert/strict';
import test from 'node:test';

import { mergeHistory, sessionCardTitle } from '../lib/history-merge.ts';

const report = (id, at) => ({ practice_session_id: id, created_at: at });
const session = (id, at) => ({ session_id: id, created_at: at });

test('정리 있는 세션은 리포트 카드로만 나온다 — 중복 없이', () => {
  const out = mergeHistory([session('a', '2026-08-01T10:00:00Z')], [report('a', '2026-08-01T10:05:00Z')]);
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, 'report');
});

test('정리 없는 세션도 목록에 나온다', () => {
  const out = mergeHistory(
    [session('a', '2026-08-02T10:00:00Z'), session('b', '2026-08-01T10:00:00Z')],
    [report('b', '2026-08-01T11:00:00Z')],
  );
  assert.deepEqual(
    out.map((e) => e.kind),
    ['session', 'report'],
  );
  assert.equal(out[0].kind === 'session' && out[0].session.session_id, 'a');
});

test('최신이 위로 온다 — 리포트·세션 섞어서', () => {
  const out = mergeHistory(
    [session('s1', '2026-08-03T00:00:00Z')],
    [report('r1', '2026-08-04T00:00:00Z'), report('r2', '2026-08-02T00:00:00Z')],
  );
  assert.deepEqual(
    out.map((e) => (e.kind === 'report' ? e.report.practice_session_id : e.session.session_id)),
    ['r1', 's1', 'r2'],
  );
});

test('장면 메모가 없으면 대신 붙일 이름을 준다 — 예전 빌드의 자리표시자도 없는 것으로 본다', () => {
  assert.equal(sessionCardTitle('  '), '장면 메모 없이 연습');
  assert.equal(sessionCardTitle(null), '장면 메모 없이 연습');
  assert.equal(sessionCardTitle('.'), '장면 메모 없이 연습');
  assert.equal(sessionCardTitle('이별 통보 직후'), '이별 통보 직후');
});
