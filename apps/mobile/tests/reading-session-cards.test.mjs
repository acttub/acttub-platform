import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isPlaybackExpired,
  practiceAgainParams,
  sessionCardMeta,
  sessionChip,
  sessionDetailMeta,
  sessionLines,
} from '../lib/reading/session-cards.ts';

const NOW = Date.parse('2026-09-21T12:00:00+09:00');

const D = (role, text) => ({ type: 'dialogue', role, text });
const X = (text) => ({ type: 'direction', text });

// 대사 1~6, 지문 둘.
const SCRIPT = {
  lines: [
    X('옥상, 밤.'),
    D('윤서', '여기 있을 줄 알았어.'),
    D('태오', '어떻게 알았어.'),
    D('윤서', '너 힘들면 항상 높은 데로 가잖아.'),
    D('태오', '(웃으며) 그런가.'),
    X('사이.'),
    D('윤서', '왜 말 안 했어.'),
    D('태오', '말하면 뭐가 달라져.'),
  ],
  lineIds: ['l0', 'l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7'],
};

const card = (o = {}) => ({
  id: 'ses_1',
  ordinal: 3,
  status: 'completed',
  my_character_ids: ['c2'],
  my_character_names: ['태오'],
  range: { start_dialogue_no: 1, end_dialogue_no: 6 },
  my_dialogue_count: 3,
  recorded_line_count: 2,
  elapsed_seconds: 252,
  started_at: '2026-09-20T21:00:00+09:00',
  ended_at: '2026-09-20T21:05:00+09:00',
  ...o,
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
  playback_url: `https://cdn/${id}`,
  playback_expires_at: '2026-09-21T12:10:00+09:00',
  ...o,
});

const detail = (o = {}) => ({
  ...card(),
  script_id: 'scr_1',
  mode: 'read',
  start_line_id: 'l1',
  end_line_id: 'l7',
  advance: 'silence',
  record: true,
  current_line_id: null,
  progress_seq: 3,
  recordings: [],
  different_lines: [],
  ...o,
});

test('reading.session: 연습 기록 줄은 "태오 · 녹음 7개 · 4:12", 회차 상세 머리는 "태오 · 어제 · 4:12"', () => {
  assert.equal(sessionCardMeta(card({ recorded_line_count: 7 })), '태오 · 녹음 7개 · 4:12');
  assert.equal(sessionCardMeta(card({ my_character_names: ['윤서', '태오'], recorded_line_count: 0, elapsed_seconds: 210 })), '윤서·태오 · 녹음 0개 · 3:30');
  assert.equal(sessionDetailMeta(card(), NOW), '태오 · 어제 · 4:12');
  assert.equal(sessionDetailMeta(card({ started_at: '2026-05-25T09:00:00+09:00', elapsed_seconds: 65 }), NOW), '태오 · 5월 25일 · 1:05');
});

test('reading.session: 상태 칩은 완료(초록)와 진행 중 · K/N(파랑) 둘이다', () => {
  assert.deepEqual(sessionChip('completed', null), { label: '완료', tone: 'completed' });
  assert.deepEqual(sessionChip('in_progress', { done: 3, total: 7 }), { label: '진행 중 · 3/7', tone: 'reading' });
  assert.deepEqual(sessionChip('in_progress', null), { label: '진행 중', tone: 'reading' });
});

test('reading.session: 회차 상세 「구간 전체」는 구간의 모든 줄(지문 포함)에 내 녹음·이어 할 줄을 붙인다', () => {
  const rows = sessionLines(
    SCRIPT,
    detail({
      status: 'in_progress',
      start_line_id: 'l2',
      end_line_id: 'l7',
      current_line_id: 'l7',
      recordings: [
        rec('r4', 'l4', { transcript_source: 'stt', transcript: '웃으며 그런가' }),
        rec('r2a', 'l2', { transcript_source: 'stt', transcript: '어떻게 알아' }),
        rec('r2b', 'l2', { attempt_no: 2, transcript_source: 'stt', transcript: '어떻게 알았어' }),
      ],
    }),
  );
  assert.deepEqual(
    rows.map((r) => [r.lineId, r.type, r.role, r.dialogueNo, r.mine, r.recording?.id ?? null, r.different, r.resumeHere]),
    [
      ['l2', 'dialogue', '태오', 2, true, 'r2b', null, false],
      ['l3', 'dialogue', '윤서', 3, false, null, null, false],
      ['l4', 'dialogue', '태오', 4, true, 'r4', null, false],
      ['l5', 'direction', null, null, false, null, null, false],
      ['l6', 'dialogue', '윤서', 5, false, null, null, false],
      ['l7', 'dialogue', '태오', 6, true, null, null, true],
    ],
  );
});

test('reading.recording: 완료 회차는 이어 할 줄이 없고, 다르게 말한 표시는 녹음 전사가 아니라 서버 different_lines 를 따른다', () => {
  const said = { line_id: 'l7', dialogue_no: 6, said: '말하면 뭐가 달라', different_words: [{ text: '말하면', differs: false }, { text: '뭐가', differs: false }, { text: '달라져.', differs: true }] };
  const rows = sessionLines(
    SCRIPT,
    detail({
      current_line_id: 'l7',
      recordings: [
        rec('r7', 'l7', { transcript_source: 'stt', transcript: '말하면 뭐가 달라' }),
        rec('r4', 'l4', { transcript_source: 'stt', transcript: '웃으며 그런가' }),
      ],
      different_lines: [said],
    }),
  );
  assert.equal(rows.length, 7);
  assert.equal(rows.some((r) => r.resumeHere), false);
  assert.deepEqual(
    rows.filter((r) => r.recording).map((r) => [r.dialogueNo, r.text, r.different?.said ?? null]),
    [
      [4, '(웃으며) 그런가.', null],
      [6, '말하면 뭐가 달라져.', '말하면 뭐가 달라'],
    ],
  );
});

test('reading.session: 구간 줄을 대본에서 못 찾으면 빈 목록', () => {
  assert.deepEqual(sessionLines(SCRIPT, detail({ start_line_id: 'gone' })), []);
});

test('reading.recording: 재생 URL이 만료됐으면(11분 뒤) 회차를 다시 조회해 새 URL을 받는다 — 만료 판정', () => {
  const r = rec('r1', 'l1');
  assert.equal(isPlaybackExpired(r, NOW), false);
  assert.equal(isPlaybackExpired(r, NOW + 11 * 60_000), true);
  assert.equal(isPlaybackExpired(rec('r2', 'l2', { playback_url: null }), NOW), true);
});

test('reading.session: [이 구간으로 다시 연습]은 그 회차의 배역·시작·끝 줄을 넘긴다', () => {
  assert.deepEqual(practiceAgainParams(detail({ my_character_ids: ['c1', 'c2'], start_line_id: 'l2', end_line_id: 'l7' })), {
    roles: 'c1,c2',
    start: 'l2',
    end: 'l7',
  });
});
