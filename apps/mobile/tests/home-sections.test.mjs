import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { homeDeadlineSections } from '../lib/home-sections.ts';

const TODAY = '2026-10-11';
const examPrep = (birth_date) => ({ experience: 'exam_prep', birth_date });

test('입시생 만 19세 이하는 연기 입시만 본다', () => {
  assert.deepEqual(homeDeadlineSections(examPrep('2007-10-11'), TODAY), { admissions: true, auditions: false }); // 만 19
  assert.deepEqual(homeDeadlineSections(examPrep('2010-03-01'), TODAY), { admissions: true, auditions: false });
  // 생일 하루 전이면 아직 19세다
  assert.deepEqual(homeDeadlineSections(examPrep('2006-10-12'), TODAY), { admissions: true, auditions: false });
});

test('입시생 만 20세 이상은 입시와 오디션 둘 다 본다', () => {
  assert.deepEqual(homeDeadlineSections(examPrep('2006-10-11'), TODAY), { admissions: true, auditions: true }); // 만 20
  assert.deepEqual(homeDeadlineSections(examPrep('1999-01-01'), TODAY), { admissions: true, auditions: true });
});

test('입시생이 아니거나 프로필이 없으면 오디션만 본다', () => {
  for (const experience of ['before_start', 'under_1y', 'y1_to_3', 'y3_to_5', 'over_5y', null]) {
    assert.deepEqual(homeDeadlineSections({ experience, birth_date: '2008-01-01' }, TODAY), { admissions: false, auditions: true });
  }
  assert.deepEqual(homeDeadlineSections(null, TODAY), { admissions: false, auditions: true });
  assert.deepEqual(homeDeadlineSections(undefined, TODAY), { admissions: false, auditions: true });
});

test('입시생인데 생년월일을 모르면 둘 다 보인다(숨기는 쪽보다 낫다)', () => {
  assert.deepEqual(homeDeadlineSections(examPrep(null), TODAY), { admissions: true, auditions: true });
});

test('홈 마감 구역(연기 입시·오디션 마감 임박)은 이 규칙으로 구역을 고른다', () => {
  const home = readFileSync(new URL('../app/(tabs)/index.tsx', import.meta.url), 'utf8');
  assert.match(home, /homeDeadlineSections\(/);
  assert.match(home, /sections\.admissions && admissions/);
  assert.match(home, /sections\.auditions && auditions/);
});
