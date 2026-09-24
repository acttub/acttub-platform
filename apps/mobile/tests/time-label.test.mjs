import assert from 'node:assert/strict';
import test from 'node:test';

import { postedAtLabel } from '../lib/time-label.ts';

// 챌린지 참여작 목록의 "언제 올렸나" (SOMA-494). 일주일 안은 상대 시간, 넘으면 날짜.
const NOW = new Date('2026-09-25T15:00:00+09:00');
const ago = (ms) => new Date(NOW.getTime() - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

test('1분 안은 방금, 한 시간 안은 분, 하루 안은 시간 단위다', () => {
  assert.equal(postedAtLabel(ago(20_000), NOW), '방금');
  assert.equal(postedAtLabel(ago(5 * MIN), NOW), '5분 전');
  assert.equal(postedAtLabel(ago(3 * HOUR), NOW), '3시간 전');
});

test('일주일 안은 며칠 전, 넘으면 올해는 월·일, 지난해면 연도까지', () => {
  assert.equal(postedAtLabel(ago(2 * DAY), NOW), '2일 전');
  assert.equal(postedAtLabel(ago(6 * DAY), NOW), '6일 전');
  assert.equal(postedAtLabel('2026-09-12T10:00:00+09:00', NOW), '9월 12일');
  assert.equal(postedAtLabel('2025-12-31T10:00:00+09:00', NOW), '2025년 12월 31일');
});

test('미래 시각(기기 시계가 늦을 때)과 못 읽는 값은 깨지지 않는다', () => {
  assert.equal(postedAtLabel(new Date(NOW.getTime() + 5 * MIN).toISOString(), NOW), '방금');
  assert.equal(postedAtLabel('not-a-date', NOW), '');
  assert.equal(postedAtLabel(null, NOW), '');
});
