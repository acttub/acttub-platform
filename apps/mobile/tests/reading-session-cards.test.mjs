import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isPlaybackExpired,
  listenQueue,
  readingHistoryRows,
  recordingSummary,
  recordingsInLineOrder,
  resumeProgress,
  sessionCardTitle,
  sessionStatusLabel,
} from '../lib/reading/session-cards.ts';

const NOW = Date.parse('2026-09-21T12:00:00+09:00');

const card = (o = {}) => ({
  id: 'ses_1',
  ordinal: 3,
  status: 'completed',
  my_character_ids: ['c1'],
  my_character_names: ['니나'],
  range: { start_dialogue_no: 1, end_dialogue_no: 5 },
  my_dialogue_count: 5,
  recorded_line_count: 2,
  elapsed_seconds: 41,
  started_at: '2026-09-20T21:00:00+09:00',
  ended_at: '2026-09-20T21:05:00+09:00',
  ...o,
});

test('reading.recording: 회차 상세 머리는 "내 대사 5개 중 2개 녹음 · 0:41 · 40%"처럼 수가 맞다', () => {
  assert.equal(recordingSummary(card()), '내 대사 5개 중 2개 녹음 · 0:41 · 40%');
  assert.equal(recordingSummary(card({ my_dialogue_count: 0, recorded_line_count: 0, elapsed_seconds: 0 })), '내 대사 0개 중 0개 녹음 · 0:00 · 0%');
  assert.equal(recordingSummary(card({ my_dialogue_count: 3, recorded_line_count: 3, elapsed_seconds: 605 })), '내 대사 3개 중 3개 녹음 · 10:05 · 100%');
});

test('reading.session: 회차 목록 항목은 회차 번호(그 대본에서 시작 순)·시작 날짜·상태를 보여 준다', () => {
  assert.equal(sessionCardTitle(card(), NOW), '3회차 · 어제');
  assert.equal(sessionCardTitle(card({ started_at: '2026-05-25T09:00:00+09:00' }), NOW), '3회차 · 5월 25일');
  assert.equal(sessionStatusLabel('in_progress'), '진행 중');
  assert.equal(sessionStatusLabel('completed'), '완료');
  assert.equal(sessionStatusLabel('stopped'), '중단');
});

test('reading.session: "이어서 연습 · K / N" — N은 구간 대사 수, K는 현재 줄 앞까지의 대사 수', () => {
  assert.deepEqual(resumeProgress(card({ range: { start_dialogue_no: 3, end_dialogue_no: 7 } }), 5), { k: 2, n: 5 });
  assert.deepEqual(resumeProgress(card({ range: { start_dialogue_no: 3, end_dialogue_no: 7 } }), null), { k: 0, n: 5 });
});

const rec = (id, line_id, o = {}) => ({
  id,
  line_id,
  attempt_no: 1,
  duration_ms: 2_000,
  content_type: 'audio/mp4',
  byte_size: 30_000,
  transcript: null,
  transcript_source: 'none',
  matched: null,
  playback_url: `https://cdn/${id}`,
  playback_expires_at: '2026-09-21T12:10:00+09:00',
  ...o,
});

test('reading.recording: 회차 상세의 녹음은 줄 순서이고 "이어 듣기"는 내 대사 녹음을 순서대로 튼다', () => {
  const detail = { recordings: [rec('r2', 'l4'), rec('r1', 'l1'), rec('r3', 'l7', { playback_url: null })] };
  const lineIds = ['l0', 'l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7'];
  assert.deepEqual(recordingsInLineOrder(detail, lineIds).map((r) => r.id), ['r1', 'r2', 'r3']);
  assert.deepEqual(listenQueue(detail, lineIds).map((r) => r.id), ['r1', 'r2'], '재생 주소가 없는 것은 건너뛴다');
});

test('reading.recording: 재생 URL이 만료됐으면(11분 뒤) 목록을 다시 조회해 새 URL을 받는다 — 만료 판정', () => {
  const r = rec('r1', 'l1');
  assert.equal(isPlaybackExpired(r, NOW), false);
  assert.equal(isPlaybackExpired(r, NOW + 11 * 60_000), true);
  assert.equal(isPlaybackExpired(rec('r2', 'l2', { playback_url: null }), NOW), true);
});

test('reading.session: 연습 기록(A1.1)에 리딩 회차 항목을 최신순으로 합친다', () => {
  const scripts = [
    { id: 's1', title: '갈매기' },
    { id: 's2', title: '옥상, 밤' },
  ];
  const sessions = {
    s1: [card({ id: 'a', started_at: '2026-09-20T21:00:00+09:00' }), card({ id: 'b', ordinal: 2, status: 'stopped', started_at: '2026-09-18T21:00:00+09:00' })],
    s2: [card({ id: 'c', ordinal: 1, status: 'in_progress', my_character_names: [], started_at: '2026-09-21T09:00:00+09:00', ended_at: null })],
  };
  const rows = readingHistoryRows(scripts, sessions);
  assert.deepEqual(rows.map((r) => r.sessionId), ['c', 'a', 'b']);
  assert.equal(rows[1].title, '갈매기 · 니나 리딩');
  assert.equal(rows[0].title, '옥상, 밤');
  assert.equal(rows[1].scriptId, 's1');
  assert.match(rows[1].meta, /완료/);
  assert.match(rows[1].meta, /녹음 2/);
});
