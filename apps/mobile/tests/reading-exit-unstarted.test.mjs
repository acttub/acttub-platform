import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createRun, discardOnExit, exitMessage } from '../lib/reading/session-run.ts';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const D = (role, text) => ({ type: 'dialogue', role, text });
const LINES = [D('윤서', '1'), D('태오', '2'), D('윤서', '3')];
const run = () => createRun({ lines: LINES, lineIds: LINES.map((_, i) => `l${i}`), myRoles: ['윤서'], startIndex: 0, endIndex: 2 });

test('reading.session: [시작] 전에 나가면 이번 회차를 남기지 않는다(새 회차·녹음 없음일 때만)', () => {
  assert.equal(discardOnExit({ started: false, progressSeq: 0, recordingCount: 0, closed: false }), true);
  assert.equal(discardOnExit({ started: true, progressSeq: 0, recordingCount: 0, closed: false }), false, '시작했으면 남긴다');
  assert.equal(discardOnExit({ started: false, progressSeq: 3, recordingCount: 0, closed: false }), false, '이어하기 회차는 남긴다');
  assert.equal(discardOnExit({ started: false, progressSeq: 0, recordingCount: 1, closed: false }), false, '녹음이 있으면 남긴다');
  assert.equal(discardOnExit({ started: false, progressSeq: 0, recordingCount: 0, closed: true }), false, '서버가 닫은 회차는 건드리지 않는다');
});

test('reading.session: 남기지 않을 때 나가기 확인 문구는 저장되지 않는다고 말한다', () => {
  assert.equal(exitMessage(run(), { discard: true }), '아직 시작하지 않아서 이번 연습은 저장되지 않아요.');
  assert.equal(exitMessage(run()), '지금 나가면 0번 대사까지 진행한 걸로 저장돼요. 상세에서 이어서 할 수 있어요.');
});

test('i18n: 저장 안 됨 나가기 문구가 ko·en 둘 다 있다', () => {
  assert.match(read('locales/ko.ts'), /exitConfirmBodyUnsaved: '아직 시작하지 않아서 이번 연습은 저장되지 않아요\.'/);
  assert.match(read('locales/en.ts'), /exitConfirmBodyUnsaved: ['"]/);
});

test('리딩 실행: 나가면 새로 쌓지 않고 기존 대본 상세로 돌아간다(dismissTo)', () => {
  const play = read('app/reading/play.tsx');
  assert.doesNotMatch(play, /router\.replace\('\/reading\/detail'\)/);
  assert.match(play, /router\.dismissTo\('\/reading\/detail'\)/);
});

test('리딩 실행: [시작] 전 나가기는 회차를 지운다 — 버튼으로 나갈 때는 지운 뒤 상세로, 다른 길(뒤로 가기)은 화면이 내려갈 때', () => {
  const play = read('app/reading/play.tsx');
  assert.match(play, /discardOnExit\(/);
  assert.match(play, /deleteSession\(/);
  assert.match(play, /startedRef\.current = true/);
  // 나가기 확인 팝업은 없앴다(10/24 하단 시트 금지) — 읽은 데까지 저장하고 바로 나간다.
  assert.doesNotMatch(play, /ReadingExitSheet/);
  assert.match(play, /addListener\('beforeRemove'/);
});
