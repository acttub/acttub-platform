import assert from 'node:assert/strict';
import test from 'node:test';

import { liveStateOf, sceneLabelAt, turnChip } from '../lib/reading/live.ts';
import { advance, createRun, pause } from '../lib/reading/session-run.ts';

const D = (role, text) => ({ type: 'dialogue', role, text });
const X = (text) => ({ type: 'direction', text });
const LINES = [X('옥상'), D('윤서', '여기 있을 줄 알았어.'), D('태오', '어떻게 알았어.'), D('윤서', '그냥.')];
const IDS = LINES.map((_, i) => `l${i}`);
const run = () => createRun({ lines: LINES, lineIds: IDS, myRoles: ['태오'], startIndex: 0, endIndex: 3 });
const live = (r, over = {}) =>
  liveStateOf({ run: r, maskMode: 'none', revealed: false, showOriginal: false, chipLabel: '듣는 중', scene: '옥상 장면', labelOf: (x) => x, ...over });

const base = { hold: null, paused: false, interrupted: false, myTurn: true, textOnly: false, turnDone: false, turnNote: null, listening: false };

test('차례 칩은 화면과 같은 순서로 정한다 — 시작 전 · 멈춤 · 상대 · 다 말함 · 시트 · 3분 · 듣는 중 · 마이크', () => {
  assert.equal(turnChip({ ...base, hold: 'tip', paused: true }).label, '시작 전');
  assert.deepEqual(turnChip({ ...base, paused: true }), { icon: 'pause', label: '일시정지' });
  assert.deepEqual(turnChip({ ...base, paused: true, interrupted: true }), { icon: 'pause', label: '멈춤' });
  assert.equal(turnChip({ ...base, myTurn: false }).label, '읽는 중');
  assert.equal(turnChip({ ...base, myTurn: false, textOnly: true }).label, '글로 보기');
  assert.equal(turnChip({ ...base, turnDone: true }).label, '다 말했어요');
  assert.equal(turnChip({ ...base, turnDone: true, turnNote: 'limit' }).label, '녹음 3분 끝');
  assert.equal(turnChip({ ...base, hold: 'mask_sheet' }).label, '넘김 멈춤');
  assert.deepEqual(turnChip({ ...base, listening: true }), { icon: 'bars', label: '듣는 중' });
  assert.deepEqual(turnChip(base), { icon: 'mic', label: '마이크 켜는 중' });
});

test('장면 이름은 지금 줄이 든 장면 제목, 제목이 없으면 「장면 N」, 장면 밖이면 대본 제목', () => {
  const scenes = [
    { no: 1, title: '옥상 장면', start_line_id: 'l0', end_line_id: 'l1' },
    { no: 2, title: null, start_line_id: 'l2', end_line_id: 'l2' },
  ];
  assert.equal(sceneLabelAt({ title: '봄날', scenes, lineIds: IDS, index: 1 }), '옥상 장면');
  assert.equal(sceneLabelAt({ title: '봄날', scenes, lineIds: IDS, index: 2 }), '장면 2');
  assert.equal(sceneLabelAt({ title: '봄날', scenes, lineIds: IDS, index: 3 }), '봄날');
});

test('상대 차례: 진행·배역 첫 글자·차례 글을 싣고, 앞 대사가 없으면 비운다', () => {
  assert.deepEqual(live(run(), { chipLabel: '읽는 중' }), {
    scene: '옥상 장면',
    progress: '0 / 3',
    shortProgress: '0/3',
    fraction: 0,
    initial: '윤',
    status: '윤서 · 읽는 중',
    headline: '윤서',
    chipLabel: '읽는 중',
    mine: false,
    paused: false,
    prevRole: null,
    prevText: null,
    text: '여기 있을 줄 알았어.',
    pauseLabel: '일시정지',
  });
});

test('내 차례: 앞 대사를 흐리게 실을 수 있게 따로 두고, 차례 글은 「배역 · 내 차례 · 칩」', () => {
  const mine = live(advance(run()));
  assert.equal(mine.status, '태오 · 내 차례 · 듣는 중');
  assert.equal(mine.headline, '내 차례 · 태오');
  assert.equal(mine.initial, '태');
  assert.equal(mine.mine, true);
  assert.equal(mine.progress, '1 / 3');
  assert.equal(mine.fraction, 1 / 3);
  assert.deepEqual([mine.prevRole, mine.prevText, mine.text], ['윤서', '여기 있을 줄 알았어.', '어떻게 알았어.']);
  assert.equal(live(pause(advance(run())), { chipLabel: '일시정지' }).paused, true);
});

test('가린 지금 대사는 「대사 가림」 — 말한 뒤·원문 보기는 원문, 앞 대사는 가리기와 상관없이 원문', () => {
  const mine = advance(run());
  assert.equal(live(mine, { maskMode: 'mine' }).text, '대사 가림');
  assert.equal(live(mine, { maskMode: 'mine', revealed: true }).text, '어떻게 알았어.');
  assert.equal(live(mine, { maskMode: 'mine', showOriginal: true }).text, '어떻게 알았어.');
  // 모두 가리기여도 지금 줄보다 앞의 대사는 가리지 않는다(10/22 결정).
  assert.equal(live(mine, { maskMode: 'all' }).prevText, '여기 있을 줄 알았어.');
  // 내 대사만 가리기: 상대 대사는 그대로.
  assert.equal(live(advance(mine), { maskMode: 'mine' }).text, '그냥.');
  assert.equal(live(advance(mine), { maskMode: 'all' }).prevText, '어떻게 알았어.');
});

test('끝났으면 보일 것이 없다', () => {
  assert.equal(live(advance(advance(advance(run())))), null);
});
