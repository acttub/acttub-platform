import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const play = readFileSync(new URL('../app/reading/play.tsx', import.meta.url), 'utf8');

test('reading.play: 지금 대사 카드의 고치기 — 멈추고 대본 전체와 같은 시트를 연다(SOMA-728)', () => {
  assert.match(play, /<LineEditSheet[\s\S]*?onClose=\{closeLineEdit\}/);
  const open = play.slice(play.indexOf('const openLineEdit'), play.indexOf('const closeLineEdit'));
  assert.match(open, /doPause\(\);/, '고치는 동안 상대 읽기·마이크를 멈춘다');
  assert.match(open, /editResumes\.current = cur\.status === 'mine' \|\| cur\.status === 'partner';/);
});

test('reading.play: 저장하면 고친 대본을 진행에 반영하고 위치를 저장한 뒤, 진행 중이었으면 이어서 한다', () => {
  const close = play.slice(play.indexOf('const closeLineEdit'), play.indexOf('const changeMask'));
  assert.match(close, /applyLineEdit\(cur, \{ lines: fresh\.lines, lineIds: fresh\.lineIds, myRoles \}\)/);
  assert.match(close, /session\.my_character_ids/, '이름을 고쳐도 내 배역을 id 로 다시 찾는다');
  assert.match(close, /queueRef\.current\?\.push\(progressPayload\(next\)\)/);
  assert.match(close, /if \(editResumes\.current\) doResume\(\);/);
});
