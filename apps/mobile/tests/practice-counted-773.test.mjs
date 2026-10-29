import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  countedPracticeDates,
  countedPractices,
  readingRunCompleted,
  readingStopCounted,
  sessionHasRecognized,
} from '../lib/practice/counted.ts';
import { readMyDialogueCount } from '../lib/reading/session-results.ts';
import { monthPracticeCounts } from '../lib/profile-month-stats.ts';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const note = { id: 'n', title: null, kind: 'focus' };

test('연습 1회: 코칭은 노트가 생긴 회차, 리딩은 끝까지 읽은 회차, 챌린지는 올린 참여작', () => {
  const counted = countedPractices({
    groups: [
      { practices: [{ created_at: '2026-10-01T00:00:00Z', note }, { created_at: '2026-10-02T00:00:00Z', note: null }] },
      { practices: [{ created_at: '2026-10-03T00:00:00Z', note: null }] },
    ],
    readingSessions: [
      { status: 'completed', started_at: '2026-10-04T00:00:00Z' },
      { status: 'in_progress', started_at: '2026-10-05T00:00:00Z' },
    ],
    entries: [{ created_at: '2026-10-06T00:00:00Z' }, { created_at: '2026-10-06T01:00:00Z' }],
  });
  assert.deepEqual(counted, [
    { kind: 'coaching', at: '2026-10-01T00:00:00Z' },
    { kind: 'reading', at: '2026-10-04T00:00:00Z' },
    { kind: 'challenge', at: '2026-10-06T00:00:00Z' },
    { kind: 'challenge', at: '2026-10-06T01:00:00Z' },
  ]);
  assert.deepEqual(countedPracticeDates({ groups: [{ practices: [{ created_at: '2026-10-01T00:00:00Z', note }] }] }), [
    { created_at: '2026-10-01T00:00:00Z' },
  ]);
  assert.deepEqual(countedPractices({}), []);
});

test('리딩 완료: 끝까지 갔으면 인식된 대사가 없어도 완료다(10/25)', () => {
  assert.equal(readingRunCompleted({ reachedEnd: true, said: { a: '안녕' } }), true);
  assert.equal(readingRunCompleted({ reachedEnd: true, said: {} }), true);
  assert.equal(readingRunCompleted({ reachedEnd: true, said: {}, recognition: 'stt' }), true);
  assert.equal(readingRunCompleted({ reachedEnd: true, said: {}, recognition: 'typing' }), true);
  assert.equal(readingRunCompleted({ reachedEnd: false, said: { a: '안녕' } }), false);
  assert.equal(readingRunCompleted({ reachedEnd: false, said: {}, priorRecognized: true }), false);
});

test('sessionHasRecognized: 녹음 전사나 원문 대조의 말한 것이 있으면 참', () => {
  assert.equal(sessionHasRecognized({ recordings: [], different_lines: [] }), false);
  assert.equal(sessionHasRecognized({ recordings: [{ transcript: ' ' }], different_lines: [{ said: null }] }), false);
  assert.equal(sessionHasRecognized({ recordings: [{ transcript: '대사' }] }), true);
  assert.equal(sessionHasRecognized({ different_lines: [{ said: '대사' }] }), true);
  assert.equal(sessionHasRecognized({}), false);
});

test('프로필 이번 달 연습도 같은 기준이다(노트 없는 회차·안 끝난 리딩 빼고, 참여작마다 1회)', () => {
  const NOW = new Date(2026, 9, 19, 12, 0, 0);
  const counts = monthPracticeCounts(
    {
      groups: [{ practices: [{ created_at: new Date(2026, 9, 3).toISOString(), note }, { created_at: new Date(2026, 9, 4).toISOString(), note: null }] }],
      readingSessions: [
        { status: 'completed', started_at: new Date(2026, 9, 2).toISOString() },
        { status: 'in_progress', started_at: new Date(2026, 9, 2).toISOString() },
      ],
      entries: [
        { created_at: new Date(2026, 9, 5).toISOString(), challenge: { id: 'x' } },
        { created_at: new Date(2026, 9, 6).toISOString(), challenge: { id: 'x' } },
      ],
    },
    NOW,
  );
  assert.deepEqual(counts, { coaching: 1, reading: 1, challenge: 2, total: 4 });
});

test('홈·프로필·리딩이 이 기준 하나를 쓴다', () => {
  assert.match(read('lib/profile-month-stats.ts'), /countedPractices\(/);
  const home = read('app/(tabs)/index.tsx');
  assert.match(home, /countedPractices\(/);
  assert.match(read('app/reading/play.tsx'), /readingRunCompleted\(/);
});

test('리딩: 「그만하기」로 끝내도 내 대사를 한 줄이라도 읽었으면 센다 — 상대 대사만 지났으면 안 센다(10/29)', () => {
  const lines = [
    { type: 'dialogue', role: '상대', text: '왔어?' },
    { type: 'direction', text: '문을 연다' },
    { type: 'dialogue', role: '나', text: '응' },
    { type: 'dialogue', role: '상대', text: '앉아' },
  ];
  assert.equal(readMyDialogueCount(lines, 0, 1, ['나']), 0);
  assert.equal(readMyDialogueCount(lines, 0, 3, ['나']), 1);
  assert.equal(readMyDialogueCount(lines, 0, -1, ['나']), 0);
  assert.equal(readingStopCounted(0), false);
  assert.equal(readingStopCounted(1), true);

  const play = read('app/reading/play.tsx');
  const stopHere = play.slice(play.indexOf('const stopHere = () =>'), play.indexOf('useWaitExit('));
  assert.match(stopHere, /stoppedEarlyRef\.current = true;/);
  assert.match(stopHere, /stopUncountedRef\.current = !readingStopCounted\(readMyDialogueCount\(/);
  // 세지 않는 회차만 멈춘 위치를 저장한다(complete false). 세는 회차는 commit 이 완료로 보낸다.
  assert.match(stopHere, /if \(stopUncountedRef\.current\) queueRef\.current\?\.push\(stoppedProgressPayload\(cur, next\)\)/);
  // 완료 판정(진행 저장·별점·완료 화면)은 모두 같은 표시를 먼저 본다.
  assert.equal((play.match(/!stopUncountedRef\.current && readingRunCompleted\(/g) ?? []).length, 2);
});
