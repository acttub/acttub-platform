import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { continueRange } from '../lib/reading/redesign-748.ts';

// SOMA-934 — 첫 리딩의 짧은 구간(처음 10줄)을 끝내면 마무리 화면에서 남은 줄을 바로 이어 읽는다.
const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

const d = (id, text) => ({ id, type: 'dialogue', role: '하윤', text });
const dir = (id, text) => ({ id, type: 'direction', text });

test('읽은 끝 줄 뒤에 대사가 남았으면 다음 대사부터 대본 끝 대사까지를 이어 읽을 구간으로 준다', () => {
  const lines = [dir('t', '지문'), d('a', '하나'), d('b', '둘'), dir('m', '사이 지문'), d('c', '셋'), d('e', '넷'), dir('z', '끝 지문')];
  // 둘(b, 2번째 줄)까지 읽었다 → 셋(c)부터 넷(e)까지.
  assert.deepEqual(continueRange(lines, 2), { startIndex: 4, endIndex: 5, fromDialogue: 3 });
});

test('대본 끝 대사까지 읽었으면 이어 읽을 구간이 없다', () => {
  const lines = [d('a', '하나'), d('b', '둘'), dir('z', '끝 지문')];
  assert.equal(continueRange(lines, 1), null);
  assert.equal(continueRange(lines, 2), null);
});

test('완료 화면(첫 리딩·독백·일반)은 구간을 끝냈고 뒤에 대사가 남았을 때만 「이어서 N줄부터 읽기」를 두고, 같은 배역으로 새 회차를 시작한다', () => {
  const src = read('app/reading/play.tsx');
  assert.match(src, /const rest = completed \? continueRange\(run\.lines, run\.endIndex\) : null;/);
  assert.match(src, /t\('reading\.wrapContinue', \{ next: rest\.fromDialogue \}\)/);
  // 첫 리딩 끝(「홈으로 가기」 밑)과 독백·일반 완료의 링크 묶음 맨 위.
  assert.match(src, /\{goHomeButton\}\n\s*\{continueRow\}/);
  assert.equal(src.split('<View style={styles.doneLinks}>\n            {continueRow}').length - 1, 2);
  assert.match(src, /const continueRest = async \(/);
  assert.match(src, /myCharacterIds: session\.my_character_ids,\s*startLineId: script\.lineIds\[range\.startIndex\],\s*endLineId: script\.lineIds\[range\.endIndex\],/);
});

test('이어 읽기 문구가 한국어·영어 둘 다 있다', () => {
  assert.match(read('locales/ko.ts'), /wrapContinue: '이어서 \{\{next\}\}줄부터 읽기'/);
  assert.match(read('locales/en.ts'), /wrapContinue: 'Keep reading from line \{\{next\}\}'/);
});
