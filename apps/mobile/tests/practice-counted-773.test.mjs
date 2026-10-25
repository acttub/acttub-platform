import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  countedPracticeDates,
  countedPractices,
  readingRunCompleted,
  sessionHasRecognized,
} from '../lib/practice/counted.ts';
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

test('리딩 완료: 끝까지 갔고 인식된 대사가 한 줄 이상일 때만', () => {
  assert.equal(readingRunCompleted({ reachedEnd: true, said: { a: '안녕' } }), true);
  assert.equal(readingRunCompleted({ reachedEnd: true, said: {} }), false);
  assert.equal(readingRunCompleted({ reachedEnd: true, said: { a: '  ' } }), false);
  assert.equal(readingRunCompleted({ reachedEnd: false, said: { a: '안녕' } }), false);
  // 이어하기 전에 서버가 받은 인식이 있으면 이번 실행이 비어도 완료다.
  assert.equal(readingRunCompleted({ reachedEnd: true, said: {}, priorRecognized: true }), true);
  assert.equal(readingRunCompleted({ reachedEnd: false, said: {}, priorRecognized: true }), false);
});

test('리딩 완료 예외: 음성 인식을 못 쓰는 기기(typing)는 끝까지 가면 완료, 인식 기기는 인식 0줄이면 미완료', () => {
  assert.equal(readingRunCompleted({ reachedEnd: true, said: {}, recognition: 'typing' }), true);
  assert.equal(readingRunCompleted({ reachedEnd: false, said: {}, recognition: 'typing' }), false);
  assert.equal(readingRunCompleted({ reachedEnd: true, said: {}, recognition: 'stt' }), false);
  assert.equal(readingRunCompleted({ reachedEnd: true, said: { a: ' ' }, recognition: 'stt' }), false);
  assert.equal(readingRunCompleted({ reachedEnd: true, said: { a: '안녕' }, recognition: 'stt' }), true);
  // 정책을 아직 모르면 인식 기기처럼 본다.
  assert.equal(readingRunCompleted({ reachedEnd: true, said: {}, recognition: null }), false);
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
