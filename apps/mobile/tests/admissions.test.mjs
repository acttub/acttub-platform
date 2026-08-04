import assert from 'node:assert/strict';
import test from 'node:test';

import {
  countdown,
  groupByUniversity,
  isOpen,
  localDate,
  matchesQuery,
  upcomingNotices,
  filterGroups,
  availableFacets,
  activeFilterCount,
  broadRegion,
  weightBars,
  formatSeconds,
  EMPTY_FILTERS,
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

// ---- 필터 ----
// 웹(apps/web/src/lib/api/v2/admissions.ts)과 같은 결과를 내야 한다.
// pnpm 워크스페이스에서 apps/mobile이 빠져 있어 코드를 공유할 수 없으므로,
// 두 구현이 갈라지지 않게 여기서 같은 계약을 건다.

const filterPayload = {
  updated_at: '2026-08-04',
  disclaimer: 'd',
  universities: [
    {
      id: 'seoul-univ',
      name: '서울대학',
      region: '서울 종로',
      type: 'univ',
      admission_url: 'x',
      resources: [],
    },
    {
      id: 'gyeonggi-col',
      name: '경기전문대',
      region: '경기 용인',
      type: 'college',
      admission_url: 'x',
      resources: [],
    },
  ],
  notices: [
    {
      id: 's1',
      university_id: 'seoul-univ',
      track: '수시',
      discipline: 'acting',
      csat_minimum: '국어 3등급',
      practical_items: [{ category: 'free_acting' }, { category: 'song' }],
      designated_works: [],
      essay_questions: [],
      stages: [],
      results: [],
    },
    {
      id: 'g1',
      university_id: 'gyeonggi-col',
      track: '정시',
      discipline: 'musical',
      csat_minimum: null,
      practical_items: [{ category: 'dance' }],
      designated_works: [],
      essay_questions: [],
      stages: [],
      results: [],
    },
  ],
};

const withFilters = (overrides) => ({ ...EMPTY_FILTERS, ...overrides });
const idsOf = (groups) => groups.map((g) => g.university.id);

test('광역 지역만 뽑아 필터 선택지를 줄인다', () => {
  assert.equal(broadRegion('경기 용인'), '경기');
  assert.equal(broadRegion(null), null);
  assert.equal(broadRegion('  '), null);
});

test('지역·설립형태로 대학을 거른다', () => {
  const groups = groupByUniversity(filterPayload);
  assert.deepEqual(idsOf(filterGroups(groups, withFilters({ regions: ['서울'] }))), ['seoul-univ']);
  assert.deepEqual(idsOf(filterGroups(groups, withFilters({ types: ['college'] }))), [
    'gyeonggi-col',
  ]);
});

test('수시·정시와 연기·뮤지컬로 공고를 거른다', () => {
  const groups = groupByUniversity(filterPayload);
  assert.deepEqual(idsOf(filterGroups(groups, withFilters({ tracks: ['수시'] }))), ['seoul-univ']);
  assert.deepEqual(idsOf(filterGroups(groups, withFilters({ disciplines: ['musical'] }))), [
    'gyeonggi-col',
  ]);
});

test('실기 종목은 하나라도 겹치면 통과한다', () => {
  const groups = groupByUniversity(filterPayload);
  assert.deepEqual(idsOf(filterGroups(groups, withFilters({ practicals: ['free_acting'] }))), [
    'seoul-univ',
  ]);
  assert.deepEqual(
    idsOf(filterGroups(groups, withFilters({ practicals: ['free_acting', 'dance'] }))),
    ['seoul-univ', 'gyeonggi-col'],
  );
  assert.deepEqual(idsOf(filterGroups(groups, withFilters({ practicals: ['improv'] }))), []);
});

test('수능 최저가 없는 전형만 남긴다', () => {
  const groups = groupByUniversity(filterPayload);
  assert.deepEqual(idsOf(filterGroups(groups, withFilters({ noCsatOnly: true }))), [
    'gyeonggi-col',
  ]);
});

// 확인하지 못한 대학이 필터를 켰다는 이유로 사라지면, 없는 것과 모르는 것을 구분할 수 없다.
test('필터를 안 켜면 공고 없는 대학도 남고, 켜면 빠진다', () => {
  const withEmpty = {
    ...filterPayload,
    universities: [
      ...filterPayload.universities,
      { id: 'unknown', name: '미확인대', region: '인천 남동', admission_url: 'x', resources: [] },
    ],
  };
  const groups = groupByUniversity(withEmpty);
  assert.ok(idsOf(filterGroups(groups, EMPTY_FILTERS)).includes('unknown'));
  assert.ok(
    !idsOf(filterGroups(groups, withFilters({ tracks: ['수시'] }))).includes('unknown'),
  );
});

test('필터 선택지는 데이터에 실제로 있는 값만 낸다', () => {
  const facets = availableFacets(filterPayload);
  assert.deepEqual(facets.regions, ['경기', '서울']);
  assert.deepEqual(facets.types, ['college', 'univ']);
  assert.deepEqual(facets.tracks, ['수시', '정시']);
  assert.deepEqual(facets.disciplines, ['acting', 'musical']);
  assert.deepEqual(facets.practicals, ['free_acting', 'song', 'dance']);
});

test('켜져 있는 필터 개수를 센다', () => {
  assert.equal(activeFilterCount(EMPTY_FILTERS), 0);
  assert.equal(activeFilterCount(withFilters({ regions: ['서울', '경기'], openOnly: true })), 3);
  assert.equal(activeFilterCount(withFilters({ query: '중앙대' })), 0);
});

test('반영비율은 값이 있는 항목만 실기부터 순서대로 그린다', () => {
  assert.deepEqual(weightBars({ practical: 70, transcript: 30, csat: null }), [
    { key: 'practical', label: '실기', value: 70 },
    { key: 'transcript', label: '학생부', value: 30 },
  ]);
  assert.deepEqual(weightBars({ practical: 0 }), []);
  assert.deepEqual(weightBars(null), []);
});

test('실기 제한시간은 분·초로 읽는다', () => {
  assert.equal(formatSeconds(120), '2분');
  assert.equal(formatSeconds(90), '1분 30초');
  assert.equal(formatSeconds(45), '45초');
});
