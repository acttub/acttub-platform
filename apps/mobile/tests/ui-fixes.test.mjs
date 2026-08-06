import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  attemptCoachStart,
  canSendCoachMessage,
} from '../lib/coach-flow.ts';
import { deletePracticeSessionIdempotently } from '../lib/delete-practice.ts';
import { sortReportsNewestFirst } from '../lib/report-order.ts';
import { createOrReuseReport } from '../lib/report-flow.ts';

const appRoot = path.resolve(import.meta.dirname, '..');
const readMobile = (relativePath) =>
  readFileSync(path.join(appRoot, relativePath), 'utf8');

test('M1: 서버 오름차순 report 목록에서 최신 항목을 첫 번째로 정렬한다', () => {
  const records = [
    { practice_session_id: 'old', report_type: 'analysis', title: 'old', created_at: '2026-07-01T00:00:00Z' },
    { practice_session_id: 'new', report_type: 'expression', title: 'new', created_at: '2026-07-23T00:00:00Z' },
    { practice_session_id: 'middle', report_type: 'analysis', title: 'middle', created_at: '2026-07-10T00:00:00Z' },
  ];

  const sorted = sortReportsNewestFirst(records);

  assert.deepEqual(
    sorted.map(({ practice_session_id }) => practice_session_id),
    ['new', 'middle', 'old'],
  );
  assert.deepEqual(
    records.map(({ practice_session_id }) => practice_session_id),
    ['old', 'new', 'middle'],
  );
});

test('M8: coachSessionId가 없으면 입력을 보낼 수 없다', () => {
  assert.equal(
    canSendCoachMessage({
      text: '답변',
      waiting: false,
      done: false,
      coachSessionId: null,
    }),
    false,
  );
  assert.equal(
    canSendCoachMessage({
      text: '답변',
      waiting: false,
      done: false,
      coachSessionId: 'coach-1',
    }),
    true,
  );
});

test('M8: coachStart 첫 실패 후 같은 helper를 재호출하면 성공한다', async () => {
  let calls = 0;
  const start = async () => {
    calls += 1;
    if (calls === 1) throw new TypeError('offline');
    return { session_id: 'coach-1', message: null, status: 'continue', handoff: null };
  };

  const first = await attemptCoachStart('practice-1', start);
  const second = await attemptCoachStart('practice-1', start);

  assert.deepEqual(first, {
    ok: false,
    message: '코치 연결에 실패했어요. 다시 시도해주세요.',
  });
  assert.equal(second.ok, true);
  assert.equal(second.response.session_id, 'coach-1');
  assert.equal(calls, 2);
});

test('M8: coachStart는 빈 대화를 열고 배우 첫 reply 전에는 코치 말풍선을 만들지 않는다', () => {
  const apiSource = readMobile('lib/api.ts');
  const coachSource = readMobile('app/coach.tsx');
  const startBlock = coachSource.slice(
    coachSource.indexOf('const startCoach = useCallback'),
    coachSource.indexOf('useEffect(() => {', coachSource.indexOf('const startCoach = useCallback')),
  );

  assert.match(apiSource, /message: string \| null;/);
  assert.match(startBlock, /practice\.coachSessionId = reply\.session_id;/);
  assert.match(startBlock, /practice\.questionCount = 0;/);
  assert.doesNotMatch(startBlock, /turns\.push|setMessages/);
  assert.match(coachSource, /막히는 대목을 그대로 적어 주세요\./);
});

test('M10: DELETE 404는 성공과 동일하게 처리한다', async () => {
  let calls = 0;
  await deletePracticeSessionIdempotently('missing', async () => {
    calls += 1;
    throw { status: 404 };
  });
  assert.equal(calls, 1);

  await assert.rejects(
    deletePracticeSessionIdempotently('broken', async () => {
      throw { status: 500 };
    }),
    (error) => error?.status === 500,
  );
});

test('W5: report 생성 실패 후 재시도하면 createReport를 다시 호출한다', async () => {
  const practice = {
    coachSessionId: 'coach-1',
    report: null,
  };
  let calls = 0;
  const createReport = async () => {
    calls += 1;
    if (calls === 1) throw new Error('서버 오류가 발생했어요. 잠시 후 다시 시도해주세요.');
    return { report_type: 'analysis', title: '완료' };
  };

  await assert.rejects(createOrReuseReport(practice, createReport));
  const report = await createOrReuseReport(practice, createReport);

  assert.deepEqual(report, { report_type: 'analysis', title: '완료' });
  assert.deepEqual(practice.report, report);
  assert.equal(calls, 2);
});
