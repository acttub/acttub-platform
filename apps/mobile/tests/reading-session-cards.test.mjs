import assert from 'node:assert/strict';
import test from 'node:test';

import {
  differentlySaid,
  isPlaybackExpired,
  practiceAgainParams,
  resumeProgress,
  sessionCardMeta,
  sessionChip,
  sessionDetailMeta,
  sessionLines,
  sessionProgress,
  sessionRangeTitle,
} from '../lib/reading/session-cards.ts';

const NOW = Date.parse('2026-09-21T12:00:00+09:00');

const D = (role, text) => ({ type: 'dialogue', role, text });
const X = (text) => ({ type: 'direction', text });

// 대사 1~6, 지문 하나. 지문 경계 장면은 5개 미만이 합쳐져 장면 하나뿐이다.
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
  matched: null,
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
  line_results: [],
  recordings: [],
  ...o,
});

test('reading.session: 연습 기록 줄은 구간 이름을 장면·대사 번호·처음부터 끝까지로 부른다', () => {
  assert.equal(sessionRangeTitle(SCRIPT.lines, card()), '처음부터 끝까지');
  assert.equal(sessionRangeTitle(SCRIPT.lines, card({ range: { start_dialogue_no: 2, end_dialogue_no: 4 } })), '대사 2~4번');
});

test('reading.session: 연습 기록 줄은 "태오 · 녹음 7개 · 4:12", 회차 상세 머리는 "태오 · 어제 · 4:12"', () => {
  assert.equal(sessionCardMeta(card({ recorded_line_count: 7 })), '태오 · 녹음 7개 · 4:12');
  assert.equal(sessionCardMeta(card({ my_character_names: ['윤서', '태오'], recorded_line_count: 0, elapsed_seconds: 210 })), '윤서·태오 · 녹음 0개 · 3:30');
  assert.equal(sessionDetailMeta(card(), NOW), '태오 · 어제 · 4:12');
  assert.equal(sessionDetailMeta(card({ started_at: '2026-05-25T09:00:00+09:00', elapsed_seconds: 65 }), NOW), '태오 · 5월 25일 · 1:05');
});

test('reading.session: "이어서 연습 · K/N" — N은 구간 대사 수, K는 현재 줄 앞까지의 대사 수', () => {
  assert.deepEqual(resumeProgress(card({ range: { start_dialogue_no: 3, end_dialogue_no: 7 } }), 5), { k: 2, n: 5 });
  assert.deepEqual(resumeProgress(card({ range: { start_dialogue_no: 3, end_dialogue_no: 7 } }), null), { k: 0, n: 5 });
  assert.deepEqual(sessionProgress(SCRIPT, detail({ status: 'in_progress', current_line_id: 'l4' })), { k: 3, n: 6 });
  assert.equal(sessionProgress(SCRIPT, detail({ status: 'completed' })), null);
});

test('reading.session: 상태 칩은 완료(초록)와 진행 중 · K/N(파랑) 둘이고, 옛 멈춤도 진행 중으로 보인다', () => {
  assert.deepEqual(sessionChip('completed', null), { label: '완료', tone: 'completed' });
  assert.deepEqual(sessionChip('in_progress', { k: 3, n: 7 }), { label: '진행 중 · 3/7', tone: 'reading' });
  assert.deepEqual(sessionChip('stopped', null), { label: '진행 중', tone: 'reading' });
});

test('reading.recording: 다르게 말한 표시는 인식으로 비교해 틀린 녹음만 — 맞게 말했거나 인식하지 않은 녹음은 원문만', () => {
  assert.equal(differentlySaid(rec('r', 'l', { matched: false, transcript_source: 'stt', transcript: '말하면 뭐가 달라' })), '말하면 뭐가 달라');
  assert.equal(differentlySaid(rec('r', 'l', { matched: true, transcript_source: 'stt', transcript: '말하면 뭐가 달라져' })), null);
  assert.equal(differentlySaid(rec('r', 'l', { matched: false, transcript_source: 'none', transcript: null })), null);
  assert.equal(differentlySaid(rec('r', 'l', { matched: false, transcript_source: 'none', transcript: '말하면' })), null);
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
        rec('r4', 'l4', { matched: true, transcript_source: 'stt', transcript: '웃으며 그런가' }),
        rec('r2a', 'l2', { matched: false, transcript_source: 'stt', transcript: '어떻게 알아' }),
        rec('r2b', 'l2', { attempt_no: 2, matched: true, transcript_source: 'stt', transcript: '어떻게 알았어' }),
      ],
    }),
  );
  assert.deepEqual(
    rows.map((r) => [r.lineId, r.type, r.role, r.dialogueNo, r.mine, r.recording?.id ?? null, r.said, r.resumeHere]),
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

test('reading.session: 완료 회차는 이어 할 줄이 없고, 다르게 말한 녹음은 말한 것을 단다', () => {
  const rows = sessionLines(
    SCRIPT,
    detail({ current_line_id: 'l7', recordings: [rec('r7', 'l7', { matched: false, transcript_source: 'stt', transcript: '말하면 뭐가 달라' })] }),
  );
  assert.equal(rows.length, 7);
  assert.equal(rows.some((r) => r.resumeHere), false);
  assert.deepEqual(
    rows.filter((r) => r.recording).map((r) => [r.dialogueNo, r.text, r.said]),
    [[6, '말하면 뭐가 달라져.', '말하면 뭐가 달라']],
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
