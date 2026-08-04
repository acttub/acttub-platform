import assert from 'node:assert/strict';
import test from 'node:test';

import {
  countdown,
  groupByUniversity,
  isOpen,
  localDate,
  matchesQuery,
  upcomingNotices,
} from '../lib/admissions.ts';

const payload = {
  updated_at: '2026-08-01',
  disclaimer: '최종 확인은 반드시 각 대학 입학처 공고로 해주세요.',
  universities: [
    { id: 'done', name: '끝난대', admission_url: 'x', region: '서울 종로', resources: [] },
    { id: 'soon', name: '곧대', admission_url: 'x', region: '경기 수원', resources: [] },
    { id: 'unknown', name: '미확인대', admission_url: 'x', resources: [] },
  ],
  notices: [
    {
      id: 'd',
      university_id: 'done',
      department: '연극학부',
      apply_start: '2026-06-22',
      apply_end: '2026-06-25',
      designated_works: [],
      essay_questions: [],
      results: [],
    },
    {
      id: 's',
      university_id: 'soon',
      department: '연기학과',
      apply_start: '2026-09-07',
      apply_end: '2026-09-11',
      designated_works: [],
      essay_questions: [],
      results: [],
    },
    {
      id: 'u',
      university_id: 'unknown',
      department: '연기전공',
      apply_start: null,
      apply_end: null,
      designated_works: [],
      essay_questions: [],
      results: [],
    },
  ],
};

// 실기 일정은 놓치면 1년을 기다린다. 접수가 임박한 곳이 위에 와야 한다.
test('접수가 빠른 대학이 앞, 끝난 곳은 뒤로 간다', () => {
  const grouped = groupByUniversity(payload, '2026-08-01');
  assert.deepEqual(
    grouped.map((g) => g.university.id),
    ['soon', 'unknown', 'done'],
  );
});

test('today를 주지 않으면 마감 여부를 따지지 않고 날짜순으로만 세운다', () => {
  const grouped = groupByUniversity(payload);
  assert.deepEqual(
    grouped.map((g) => g.university.id),
    ['done', 'soon', 'unknown'],
  );
});

test('접수 전이면 시작까지, 접수 중이면 마감까지 센다', () => {
  const notice = { apply_start: '2026-09-08', apply_end: '2026-09-11' };
  assert.deepEqual(countdown(notice, '2026-08-29'), { label: '접수 시작', days: 10 });
  assert.deepEqual(countdown(notice, '2026-09-09'), { label: '접수 마감', days: 2 });
  assert.deepEqual(countdown(notice, '2026-09-11'), { label: '접수 마감', days: 0 });
});

// 이미 끝났거나 날짜를 모르는 공고에 D-day를 붙이면 거짓말이 된다.
test('끝났거나 날짜가 없으면 카운트다운이 없다', () => {
  assert.equal(countdown({ apply_start: '2026-09-08', apply_end: '2026-09-11' }, '2026-09-12'), null);
  assert.equal(countdown({ apply_start: null, apply_end: null }, '2026-09-12'), null);
});

test('마감일을 모르면 닫혔다고 단정하지 않는다', () => {
  assert.equal(isOpen({ apply_end: null }, '2026-12-31'), true);
  assert.equal(isOpen({ apply_end: '2026-09-11' }, '2026-09-11'), true);
  assert.equal(isOpen({ apply_end: '2026-09-11' }, '2026-09-12'), false);
});

// 홈 카드는 두 줄만 쓴다. 카운트다운이 없는 공고가 섞이면 빈 줄이 생긴다.
test('홈 카드는 카운트다운 있는 공고만 개수만큼 준다', () => {
  const rows = upcomingNotices(payload, '2026-08-01', 2);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].university.id, 'soon');
  assert.equal(rows[0].remaining.label, '접수 시작');
});

test('대학명·지역·학과 어느 쪽으로도 검색된다', () => {
  const [group] = groupByUniversity(payload, '2026-08-01');
  assert.equal(matchesQuery(group, '곧대'), true);
  assert.equal(matchesQuery(group, '수원'), true);
  assert.equal(matchesQuery(group, '연기'), true);
  assert.equal(matchesQuery(group, '   '), true);
  assert.equal(matchesQuery(group, '무용'), false);
});

// UTC로 자르면 한국 오전에 하루가 밀린다.
test('오늘 날짜는 기기 시간대 기준으로 만든다', () => {
  const at = new Date(2026, 7, 1, 8, 30);
  assert.equal(localDate(at), '2026-08-01');
});
