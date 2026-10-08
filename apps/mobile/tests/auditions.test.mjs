import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EMPTY_AUDITION_FILTERS,
  auditionSections,
  categoryKey,
  daysUntil,
  deadlineBucket,
  filterAuditions,
  groupCounts,
  groupOf,
  hasPay,
  isNewPosting,
  kstDate,
  matchesAuditionQuery,
  normalizeAuditions,
  urgentAuditions,
} from '../lib/auditions.ts';

const TODAY = '2026-10-08';

function posting(overrides = {}) {
  return {
    id: 'otr-1',
    title: '단편영화 주연 배우 모집',
    category: 'short_film',
    source: 'otr',
    source_name: 'OTR',
    pay_text: null,
    apply_start: null,
    apply_end: null,
    status_text: null,
    posted_on: '2026-10-01',
    source_url: 'https://example.com/1',
    ...overrides,
  };
}

test('auditions: kstDate는 기기 시간대와 무관하게 한국 날짜를 낸다', () => {
  // UTC 10월 7일 15:30 = KST 10월 8일 00:30
  assert.equal(kstDate(new Date('2026-10-07T15:30:00Z')), '2026-10-08');
  // UTC 10월 7일 14:59 = KST 10월 7일 23:59
  assert.equal(kstDate(new Date('2026-10-07T14:59:00Z')), '2026-10-07');
});

test('auditions: daysUntil은 날짜 차이, 없으면 null', () => {
  assert.equal(daysUntil('2026-10-08', TODAY), 0);
  assert.equal(daysUntil('2026-10-11', TODAY), 3);
  assert.equal(daysUntil('2026-11-01', TODAY), 24);
  assert.equal(daysUntil('2026-10-07', TODAY), -1);
  assert.equal(daysUntil(null, TODAY), null);
  assert.equal(daysUntil(undefined, TODAY), null);
});

test('auditions: 마감 구간 — 7일 이내 / 14일 이내 / 그 뒤 / 날짜 없음', () => {
  assert.equal(deadlineBucket(posting({ apply_end: '2026-10-08' }), TODAY), 'week');
  assert.equal(deadlineBucket(posting({ apply_end: '2026-10-15' }), TODAY), 'week');
  assert.equal(deadlineBucket(posting({ apply_end: '2026-10-16' }), TODAY), 'twoWeeks');
  assert.equal(deadlineBucket(posting({ apply_end: '2026-10-22' }), TODAY), 'twoWeeks');
  assert.equal(deadlineBucket(posting({ apply_end: '2026-10-23' }), TODAY), 'later');
  assert.equal(deadlineBucket(posting({ apply_end: null }), TODAY), 'unknown');
});

test('auditions: 분야 그룹 매핑, 모르는 분야는 기타', () => {
  for (const c of ['film', 'short_film', 'drama', 'web_drama']) assert.equal(groupOf(c), 'screen');
  assert.equal(groupOf('short_form'), 'shortForm');
  assert.equal(groupOf('commercial'), 'ad');
  assert.equal(groupOf('music_video'), 'ad');
  assert.equal(groupOf('theater'), 'theater');
  assert.equal(groupOf('musical'), 'musical');
  assert.equal(groupOf('agency_open'), 'agency');
  assert.equal(groupOf('other'), 'other');
  assert.equal(groupOf('something_new'), 'other');
});

test('auditions: categoryKey — 모르는 분야는 other', () => {
  assert.equal(categoryKey('web_drama'), 'web_drama');
  assert.equal(categoryKey('podcast'), 'other');
});

test('auditions: groupCounts는 0건 그룹을 빼고 전체를 맨 앞에 둔다', () => {
  const items = [
    posting({ id: 'a', category: 'film' }),
    posting({ id: 'b', category: 'drama' }),
    posting({ id: 'c', category: 'musical' }),
  ];
  assert.deepEqual(groupCounts(items), [
    { key: 'all', count: 3 },
    { key: 'screen', count: 2 },
    { key: 'musical', count: 1 },
  ]);
  assert.deepEqual(groupCounts([]), [{ key: 'all', count: 0 }]);
});

test('auditions: 검색은 제목·출연료 문구·출처 이름, 공백으로 나눈 말 전부', () => {
  const p = posting({ title: '웹드라마 조연', pay_text: '회당 30만원', source_name: '신씨네' });
  assert.equal(matchesAuditionQuery(p, ''), true);
  assert.equal(matchesAuditionQuery(p, '  '), true);
  assert.equal(matchesAuditionQuery(p, '조연'), true);
  assert.equal(matchesAuditionQuery(p, '30만'), true);
  assert.equal(matchesAuditionQuery(p, '신씨네'), true);
  assert.equal(matchesAuditionQuery(p, '웹드라마 신씨네'), true);
  assert.equal(matchesAuditionQuery(p, '웹드라마 뮤지컬'), false);
  assert.equal(matchesAuditionQuery(posting({ title: 'MV Cast' }), 'mv'), true);
});

test('auditions: 출연료 명시 — 문구가 있고 협의로 시작하지 않을 때', () => {
  assert.equal(hasPay(posting({ pay_text: '회당 30만원' })), true);
  assert.equal(hasPay(posting({ pay_text: '협의' })), false);
  assert.equal(hasPay(posting({ pay_text: ' 협의 후 결정' })), false);
  assert.equal(hasPay(posting({ pay_text: '' })), false);
  assert.equal(hasPay(posting({ pay_text: null })), false);
});

test('auditions: NEW는 게시 1일 이내', () => {
  assert.equal(isNewPosting(posting({ posted_on: '2026-10-08' }), TODAY), true);
  assert.equal(isNewPosting(posting({ posted_on: '2026-10-07' }), TODAY), true);
  assert.equal(isNewPosting(posting({ posted_on: '2026-10-06' }), TODAY), false);
  assert.equal(isNewPosting(posting({ posted_on: null }), TODAY), false);
});

test('auditions: 필터 — 그룹·7일·출연료·찜·검색, 지난 마감은 뺀다', () => {
  const items = [
    posting({ id: 'a', category: 'film', apply_end: '2026-10-10', pay_text: '50만원' }),
    posting({ id: 'b', category: 'musical', apply_end: '2026-10-30', pay_text: '협의' }),
    posting({ id: 'c', category: 'film', apply_end: null }),
    posting({ id: 'd', category: 'film', apply_end: '2026-10-07' }),
  ];
  const ids = (list) => list.map((p) => p.id);
  const none = new Set();
  assert.deepEqual(ids(filterAuditions(items, EMPTY_AUDITION_FILTERS, TODAY, none)), ['a', 'b', 'c']);
  assert.deepEqual(
    ids(filterAuditions(items, { ...EMPTY_AUDITION_FILTERS, group: 'screen' }, TODAY, none)),
    ['a', 'c'],
  );
  assert.deepEqual(
    ids(filterAuditions(items, { ...EMPTY_AUDITION_FILTERS, week: true }, TODAY, none)),
    ['a'],
  );
  assert.deepEqual(
    ids(filterAuditions(items, { ...EMPTY_AUDITION_FILTERS, paid: true }, TODAY, none)),
    ['a'],
  );
  assert.deepEqual(
    ids(filterAuditions(items, { ...EMPTY_AUDITION_FILTERS, starred: true }, TODAY, new Set(['b']))),
    ['b'],
  );
});

test('auditions: 섹션은 구간 순서, 안에서는 마감 빠른 순·게시 최신 순, 빈 구간은 없다', () => {
  const items = [
    posting({ id: 'later', apply_end: '2026-11-30' }),
    posting({ id: 'unknown-old', apply_end: null, posted_on: '2026-09-20' }),
    posting({ id: 'week2', apply_end: '2026-10-12' }),
    posting({ id: 'week1', apply_end: '2026-10-09' }),
    posting({ id: 'unknown-new', apply_end: null, posted_on: '2026-10-05' }),
  ];
  const sections = auditionSections(items, TODAY);
  assert.deepEqual(
    sections.map((s) => [s.bucket, s.data.map((p) => p.id)]),
    [
      ['week', ['week1', 'week2']],
      ['later', ['later']],
      ['unknown', ['unknown-new', 'unknown-old']],
    ],
  );
});

test('auditions: 홈 임박 — 마감일 있는 열린 공고를 가까운 순으로 N개', () => {
  const items = [
    posting({ id: 'far', apply_end: '2026-12-01' }),
    posting({ id: 'none', apply_end: null }),
    posting({ id: 'past', apply_end: '2026-10-01' }),
    posting({ id: 'soon', apply_end: '2026-10-09' }),
    posting({ id: 'today', apply_end: '2026-10-08' }),
  ];
  assert.deepEqual(
    urgentAuditions(items, TODAY, 2).map((r) => [r.posting.id, r.days]),
    [
      ['today', 0],
      ['soon', 1],
    ],
  );
  assert.deepEqual(urgentAuditions([], TODAY, 2), []);
});

test('auditions: normalize — items가 없거나 null이면 빈 목록', () => {
  assert.deepEqual(normalizeAuditions({ collected_at: null }), { items: [], collected_at: null });
  assert.deepEqual(normalizeAuditions({ items: null, collected_at: '2026-10-08T07:00:00+09:00' }), {
    items: [],
    collected_at: '2026-10-08T07:00:00+09:00',
  });
});
