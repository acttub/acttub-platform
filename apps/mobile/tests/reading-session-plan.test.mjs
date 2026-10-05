import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildStartBody,
  defaultMyCharacterIds,
  dialogueNumbers,
  rangeError,
  rangeName,
  rangeTitle,
  sceneRanges,
  snapRangeToDialogues,
} from '../lib/reading/session-plan.ts';

const D = (role, text) => ({ type: 'dialogue', role, text });
const X = (text) => ({ type: 'direction', text });
const S = (text) => ({ type: 'scene', text });

const WITH_SCENES = [S('1막'), D('윤서', 'a'), D('태오', 'b'), X('사이'), D('윤서', 'c'), S('2막'), X('밤'), D('태오', 'd'), D('윤서', 'e')];
const NO_SCENES = [X('옥상'), D('윤서', 'a'), D('태오', 'b'), X('사이'), D('윤서', 'c'), D('태오', 'd')];

test('reading.session: 장면 "1막"을 고르면 그 장면의 첫·마지막 대사가 구간이다', () => {
  const scenes = sceneRanges(WITH_SCENES);
  assert.deepEqual(scenes.map((s) => s.title), ['1막', '2막']);
  assert.deepEqual(scenes.map((s) => [s.startIndex, s.endIndex]), [[1, 4], [7, 8]]);
  assert.deepEqual(scenes.map((s) => s.dialogueCount), [3, 2]);
});

const lines = (n, role = '윤서') => Array.from({ length: n }, (_, i) => D(i % 2 ? '태오' : role, `${i}`));

test('reading.session: 장면 줄 없는 대본은 지문 경계로 장면이 나뉘고 번호가 붙는다', () => {
  const script = [X('옥상'), ...lines(5), X('사이'), ...lines(6)];
  const scenes = sceneRanges(script);
  assert.deepEqual(scenes.map((s) => [s.title, s.no]), [[null, 1], [null, 2]]);
  assert.deepEqual(scenes.map((s) => [s.startIndex, s.endIndex]), [[1, 5], [7, 12]]);
});

test('reading.session: 지문으로 끊긴 장면 가운데 대사 5개 미만은 앞 장면에 붙인다', () => {
  const script = [X('옥상'), ...lines(6), X('사이'), ...lines(2), X('밤'), ...lines(5)];
  const scenes = sceneRanges(script);
  assert.deepEqual(scenes.map((s) => [s.no, s.startIndex, s.endIndex, s.dialogueCount]), [[1, 1, 9, 8], [2, 11, 15, 5]]);
});

test('reading.session: 첫 장면이 짧으면 뒤 장면에 붙인다', () => {
  const script = [X('옥상'), ...lines(2), X('사이'), ...lines(5)];
  const scenes = sceneRanges(script);
  assert.deepEqual(scenes.map((s) => [s.no, s.startIndex, s.endIndex, s.dialogueCount]), [[1, 1, 8, 7]]);
});

test('reading.session: 막·장 머리로 나뉜 장면은 짧아도 합치지 않는다', () => {
  assert.deepEqual(sceneRanges(WITH_SCENES).map((s) => s.dialogueCount), [3, 2]);
});

const t = (key, p = {}) => `${key}${JSON.stringify(p)}`;

test('reading.session: 구간 이름 — 대본 전체·장면 하나와 정확히 같을 때·그 밖은 대사 번호', () => {
  const script = [X('옥상'), ...lines(5), X('사이'), ...lines(6)];
  assert.deepEqual(rangeName(script, 1, 11), { kind: 'all' });
  assert.deepEqual(rangeName(script, 6, 11), { kind: 'scene', title: null, no: 2 });
  assert.deepEqual(rangeName(script, 6, 10), { kind: 'dialogues', start: 6, end: 10 });
  assert.equal(rangeTitle(rangeName(script, 1, 11), t), 'reading.rangeAll{}');
  assert.equal(rangeTitle(rangeName(script, 6, 11), t), 'reading.rangeScene{"n":2}');
  assert.equal(rangeTitle(rangeName(script, 6, 10), t), 'reading.rangeLines{"start":6,"end":10}');
  assert.equal(rangeTitle(rangeName(WITH_SCENES, 4, 5), t), '2막');
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

test('reading.session: 회차 시작 본문 — 요청 id·내 배역 id·방식·구간 줄 id·넘김·녹음', () => {
  const body = buildStartBody({
    requestId: 'rid-1',
    myCharacterIds: ['c1'],
    mode: 'quiz',
    startLineId: 'l1',
    endLineId: 'l9',
    advance: 'silence',
    record: false,
  });
  assert.deepEqual(body, {
    request_id: 'rid-1',
    my_character_ids: ['c1'],
    mode: 'quiz',
    start_line_id: 'l1',
    end_line_id: 'l9',
    advance: 'silence',
    record: false,
  });
});

test('reading.cast: 배역 화면의 기본 선택은 마지막 회차의 내 배역이고 회차가 없으면 아무것도 골라 두지 않는다', () => {
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
