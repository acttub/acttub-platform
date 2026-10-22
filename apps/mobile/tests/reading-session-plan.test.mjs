import assert from 'node:assert/strict';
import test from 'node:test';

import {
  roleLabel,
  turnRoles,
  buildStartBody,
  defaultMyCharacterIds,
  dialogueNumbers,
  fewLines,
  isGroupCharacter,
  roleLineCount,
  rangeError,
  rangeOfDialogueNos,
  rangeOfLineIds,
  rangeTitle,
  recentRanges,
  sceneTitle,
  snapRangeToDialogues,
  startGate,
} from '../lib/reading/session-plan.ts';

const D = (role, text) => ({ type: 'dialogue', role, text });
const X = (text) => ({ type: 'direction', text });
const S = (text) => ({ type: 'scene', text });

const WITH_SCENES = [S('1막'), D('윤서', 'a'), D('태오', 'b'), X('사이'), D('윤서', 'c'), S('2막'), X('밤'), D('태오', 'd'), D('윤서', 'e')];

const t = (key, p = {}) => `${key}${JSON.stringify(p)}`;

test('reading.session: 구간 이름의 글 — 서버 range_name 을 처음부터 끝까지·장면(머리 줄 글 또는 번호)·대사 번호로', () => {
  const blank = { scene_no: null, scene_title: null };
  assert.equal(rangeTitle({ kind: 'all', ...blank, start: 1, end: 11 }, t), 'reading.rangeAll{}');
  assert.equal(rangeTitle({ kind: 'scene', scene_no: 2, scene_title: null, start: 6, end: 11 }, t), 'reading.rangeScene{"n":2}');
  assert.equal(rangeTitle({ kind: 'scene', scene_no: 2, scene_title: '2막', start: 4, end: 5 }, t), '2막');
  assert.equal(rangeTitle({ kind: 'dialogues', ...blank, start: 6, end: 10 }, t), 'reading.rangeLines{"start":6,"end":10}');
});

test('reading.session: 「장면으로 찾기」 줄 이름 — 서버 scenes 의 title, 없으면 번호', () => {
  assert.equal(sceneTitle({ no: 1, title: '1막' }, t), '1막');
  assert.equal(sceneTitle({ no: 2, title: null }, t), 'reading.rangeScene{"n":2}');
});

test('reading.session: 대사 번호는 대사 줄만 1부터 세고 지문·장면은 없다', () => {
  assert.deepEqual(dialogueNumbers(WITH_SCENES), [null, 1, 2, null, 3, null, null, 4, 5]);
});

test('reading.session: 구간은 시작·끝 대사(둘 다 포함)이고 지문에 걸린 선택은 안쪽 대사로 당긴다', () => {
  assert.deepEqual(snapRangeToDialogues(WITH_SCENES, 0, 8), { startIndex: 1, endIndex: 8 });
  assert.deepEqual(snapRangeToDialogues(WITH_SCENES, 3, 6), { startIndex: 4, endIndex: 4 });
  assert.equal(snapRangeToDialogues(WITH_SCENES, 5, 6), null, '대사가 없는 구간');
});

test('reading.session: 구간 안에 내 대사가 없거나 시작 줄이 끝 줄 뒤면 empty_range(기기 사전 검사)', () => {
  assert.equal(rangeError(WITH_SCENES, ['태오'], 1, 1), 'empty_range');
  assert.equal(rangeError(WITH_SCENES, ['윤서'], 4, 1), 'empty_range');
  assert.equal(rangeError(WITH_SCENES, ['윤서'], 1, 4), null);
  assert.equal(rangeError(WITH_SCENES, ['윤서', '태오'], 1, 8), null);
});

test('reading.session: 회차 시작 본문 — 앱은 늘 읽어주기·녹음·말이 끝나면 넘김', () => {
  const body = buildStartBody({ requestId: 'rid-1', myCharacterIds: ['c1', 'c2'], startLineId: 'l1', endLineId: 'l9' });
  assert.deepEqual(body, {
    request_id: 'rid-1',
    my_character_ids: ['c1', 'c2'],
    mode: 'read',
    start_line_id: 'l1',
    end_line_id: 'l9',
    advance: 'silence',
    record: true,
  });
});

test('reading.cast: 내 배역의 기본 선택은 마지막 회차의 내 배역이고 회차가 없으면 아무것도 골라 두지 않는다', () => {
  assert.deepEqual(defaultMyCharacterIds({ last_session: null, characters: [{ id: 'a' }, { id: 'b' }] }), []);
  assert.deepEqual(
    defaultMyCharacterIds({ last_session: { my_character_ids: ['b', 'zzz'] }, characters: [{ id: 'a' }, { id: 'b' }] }),
    ['b'],
    '대본에 없는 id 는 버린다',
  );
});

test('reading.cast: 배역이 하나뿐인 대본은 그 배역이 내 배역이다', () => {
  assert.deepEqual(defaultMyCharacterIds({ last_session: null, characters: [{ id: 'only' }] }), ['only']);
});

test('reading.cast: 회차 상세에서 넘긴 배역이 있으면 지난 회차보다 그것이 먼저다', () => {
  const script = { last_session: { my_character_ids: ['a'] }, characters: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] };
  assert.deepEqual(defaultMyCharacterIds({ ...script, rolesParam: 'c,b' }), ['c', 'b']);
  assert.deepEqual(defaultMyCharacterIds({ ...script, rolesParam: 'zzz' }), ['a'], '대본에 없는 id 뿐이면 지난 회차');
  assert.deepEqual(defaultMyCharacterIds({ ...script, rolesParam: '' }), ['a']);
});

test('SOMA-709 9번: 마지막 회차의 묶음 배역·사라진 배역·대사 2줄 이하 배역은 다음 회차 기본값으로 다시 고르지 않는다', () => {
  const characters = [
    { id: 'a', dialogue_count: 8 },
    { id: 'b', dialogue_count: 2 },
    { id: 'g', dialogue_count: 5, member_ids: ['a', 'b'] },
    { id: 'c', dialogue_count: 3 },
  ];
  assert.deepEqual(defaultMyCharacterIds({ last_session: { my_character_ids: ['a', 'b', 'g', 'gone'] }, characters }), ['a']);
  assert.deepEqual(defaultMyCharacterIds({ last_session: { my_character_ids: ['b', 'g'] }, characters }), [], '남는 배역이 없으면 고르게 둔다');
  assert.deepEqual(defaultMyCharacterIds({ last_session: { my_character_ids: ['c'] }, characters }), ['c']);
  assert.deepEqual(
    defaultMyCharacterIds({ last_session: { my_character_ids: ['b'] }, characters: [{ id: 'a' }, { id: 'b' }] }),
    ['b'],
    '대사 수를 모르는 옛 응답이면 대사 수로 거르지 않는다',
  );
  assert.deepEqual(defaultMyCharacterIds({ last_session: null, characters, rolesParam: 'b,g' }), ['b'], '회차 상세가 넘긴 배역은 묶음만 뺀다');
  assert.deepEqual(
    defaultMyCharacterIds({ last_session: null, characters: [{ id: 'a' }, { id: 'g', member_ids: ['a', 'x'] }] }),
    ['a'],
    '묶음을 빼고 하나뿐이면 그 배역',
  );
});

test('SOMA-709 7번: 묶음 배역은 칩에 두지 않고, 대사 수는 서버 값이 없으면 대본 줄에서 센다', () => {
  assert.equal(isGroupCharacter({ member_ids: ['a', 'b'] }), true);
  assert.equal(isGroupCharacter({ member_ids: [] }), false);
  assert.equal(isGroupCharacter({}), false);
  assert.equal(roleLineCount({ name: '윤서', dialogue_count: 8 }, WITH_SCENES), 8);
  assert.equal(roleLineCount({ name: '윤서' }, WITH_SCENES), 3);
});

test('SOMA-709 8번: 고른 배역(여럿이면 합쳐서)의 구간 안 대사가 1~2줄이면 그 수, 3줄 이상이거나 없으면 null', () => {
  assert.equal(fewLines(WITH_SCENES, ['태오'], 0, WITH_SCENES.length - 1), 2);
  assert.equal(fewLines(WITH_SCENES, ['윤서'], 0, WITH_SCENES.length - 1), null);
  assert.equal(fewLines(WITH_SCENES, ['윤서'], 0, 4), 2);
  assert.equal(fewLines(WITH_SCENES, ['윤서', '태오'], 0, 4), null, '합쳐서 3줄');
  assert.equal(fewLines(WITH_SCENES, ['태오'], 4, 6), null, '0줄은 시작할 때 막는다');
  assert.equal(fewLines(WITH_SCENES, [], 0, 8), null);
});

test('reading.session: 대사 번호 구간을 줄 인덱스로 — 대본에 없는 번호는 null', () => {
  assert.deepEqual(rangeOfDialogueNos(WITH_SCENES, 3, 5), { startIndex: 4, endIndex: 8 });
  assert.deepEqual(rangeOfDialogueNos(WITH_SCENES, 2, 2), { startIndex: 2, endIndex: 2 });
  assert.equal(rangeOfDialogueNos(WITH_SCENES, 4, 9), null);
  assert.equal(rangeOfDialogueNos(WITH_SCENES, 4, 2), null);
});

test('reading.session: 회차 상세가 넘긴 시작·끝 줄 id를 줄 인덱스로', () => {
  const ids = ['l0', 'l1', 'l2', 'l3'];
  assert.deepEqual(rangeOfLineIds(ids, 'l1', 'l3'), { startIndex: 1, endIndex: 3 });
  assert.equal(rangeOfLineIds(ids, 'l3', 'l1'), null);
  assert.equal(rangeOfLineIds(ids, undefined, 'l1'), null);
  assert.equal(rangeOfLineIds(ids, 'l1', 'gone'), null);
});

const card = (id, start, end, started_at) => ({ id, range: { start_dialogue_no: start, end_dialogue_no: end }, started_at });

test('reading.session: 최근 구간은 같은 구간을 가장 최근 회차 하나로 모으고 최근 순이다', () => {
  const sessions = [
    card('s1', 1, 110, '2026-05-24T10:00:00Z'),
    card('s4', 30, 87, '2026-10-04T10:00:00Z'),
    card('s2', 5, 12, '2026-05-25T10:00:00Z'),
    card('s3', 30, 87, '2026-06-01T10:00:00Z'),
  ];
  assert.deepEqual(recentRanges(sessions).map((s) => s.id), ['s4', 's2', 's1']);
  assert.deepEqual(recentRanges([]), []);
});

test('reading.session: 시작 버튼 — 배역 없음 → 마이크 없음 → 아직 모름 → 시작', () => {
  assert.equal(startGate({ roleCount: 0, micGranted: false, loading: true }), 'pickRole');
  assert.equal(startGate({ roleCount: 1, micGranted: false, loading: false }), 'needMic');
  assert.equal(startGate({ roleCount: 1, micGranted: null, loading: false }), 'wait');
  assert.equal(startGate({ roleCount: 2, micGranted: true, loading: true }), 'wait');
  assert.equal(startGate({ roleCount: 2, micGranted: true, loading: false }), 'ready');
});

test('reading.session(SOMA-785): 함께 말하는 줄은 멤버에 내 배역이 있으면 내 차례이고, 이름표는 「함께 · 윤서·태오」', () => {
  const characters = [
    { id: 'c1', name: '윤서', member_ids: [] },
    { id: 'c2', name: '태오', member_ids: [] },
    { id: 'c3', name: '민지' },
    { id: 'g1', name: '윤서, 태오', member_ids: ['c1', 'c2'] },
    { id: 'g2', name: '태오, 민지', member_ids: ['c2', 'c3'] },
  ];
  assert.deepEqual(turnRoles(characters, ['c1']), ['윤서', '윤서, 태오']);
  assert.deepEqual(turnRoles(characters, ['c3']), ['민지', '태오, 민지']);
  assert.deepEqual(turnRoles(characters, []), []);
  assert.equal(roleLabel(characters, '윤서, 태오', '함께'), '함께 · 윤서·태오');
  assert.equal(roleLabel(characters, '윤서', '함께'), '윤서', '보통 배역은 이름 그대로');
  assert.equal(roleLabel(characters, '없는 이름', '함께'), '없는 이름');
});

test('리딩 3번: 서버 대사 수가 없으면 그 배역이 든 함께 말하는 줄까지 센다 — 범위 안내도 turnRoles 기준', () => {
  const characters = [
    { id: 'a', name: '윤서', member_ids: [] },
    { id: 'b', name: '태오', member_ids: [] },
    { id: 'g', name: '윤서, 태오', member_ids: ['a', 'b'] },
  ];
  const lines = [D('윤서', '1'), D('태오', '2'), D('윤서', '3'), D('윤서', '4'), D('윤서', '5'), D('윤서, 태오', '6')];
  assert.equal(roleLineCount({ id: 'a', name: '윤서' }, lines, characters), 5, '보통 4줄 + 묶음 1줄');
  assert.equal(roleLineCount({ id: 'b', name: '태오' }, lines, characters), 2);
  assert.equal(roleLineCount({ id: 'a', name: '윤서', dialogue_count: 5 }, lines, characters), 5, '서버 값이 이긴다');
  assert.equal(roleLineCount({ id: 'a', name: '윤서' }, lines), 4, 'characters 가 없으면 이름 줄만');
  // 태오 혼자면 구간 전체에 1줄 + 묶음 1줄 = 2줄 → 안내, 묶음을 빼면 1줄로 잘못 셌다.
  assert.equal(fewLines(lines, turnRoles(characters, ['b']), 0, lines.length - 1), 2);
  assert.equal(fewLines(lines, turnRoles(characters, ['b']), 2, 5), 1, '묶음 줄만 있는 구간도 0줄이 아니다');
  assert.equal(fewLines(lines, turnRoles(characters, ['a', 'b']), 0, 2), null, '여럿 골라도 한 줄을 두 번 세지 않는다(3줄)');
  assert.equal(fewLines(lines, turnRoles(characters, ['a', 'b']), 4, 5), 2, '묶음 줄은 한 번');
});
