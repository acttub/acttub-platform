import assert from 'node:assert/strict';
import test from 'node:test';

import { canInsertLine, canSaveLineDraft, defaultInsertSpeaker, insertLineOf, linePatch, splitGuess } from '../lib/reading/line-edit.ts';

const DIALOGUE = { kind: 'dialogue', characterId: 'c1', text: '여기 있을 줄 알았어.' };
const DIRECTION = { kind: 'direction', characterId: null, text: '사이' };

test('reading.script(SOMA-669): 줄 고치기는 바뀐 항목만 보낸다', () => {
  assert.equal(linePatch(DIALOGUE, { ...DIALOGUE }), null, '그대로면 보낼 것이 없다');
  assert.deepEqual(linePatch(DIALOGUE, { ...DIALOGUE, characterId: 'c2' }), { characterId: 'c2' });
  assert.deepEqual(linePatch(DIALOGUE, { ...DIALOGUE, text: '  여기 있을 줄 알았다.  ' }), { text: '여기 있을 줄 알았다.' });
  assert.deepEqual(linePatch(DIALOGUE, { ...DIALOGUE, text: ' 여기 있을 줄 알았어. ' }), null, '앞뒤 공백만 달라도 그대로다');
  assert.deepEqual(linePatch(DIALOGUE, { ...DIALOGUE, kind: 'direction' }), { kind: 'direction' }, '지문으로 바꾸면 배역은 서버가 뺀다');
  assert.deepEqual(linePatch(DIRECTION, { ...DIRECTION, kind: 'dialogue', characterId: 'c1' }), { kind: 'dialogue', characterId: 'c1' });
});

test('reading.script(SOMA-669): 대사인데 배역을 안 골랐거나 글이 비면 저장을 막는다', () => {
  assert.equal(canSaveLineDraft(DIRECTION, { ...DIRECTION, kind: 'dialogue' }), false);
  assert.equal(canSaveLineDraft(DIALOGUE, { ...DIALOGUE, text: '   ' }), false);
  assert.equal(canSaveLineDraft(DIALOGUE, { ...DIALOGUE }), false, '바뀐 게 없으면 저장할 것이 없다');
  assert.equal(canSaveLineDraft(DIALOGUE, { ...DIALOGUE, characterId: 'c2' }), true);
});

test('reading.script(SOMA-785): 둘로 나누기는 가운데에 가까운 문장 끝, 없으면 띄어쓰기, 없으면 가운데 글자에서 자른다', () => {
  assert.deepEqual(splitGuess(' 안녕하세요. 저는 이영입니다. 만나서 반갑습니다. '), ['안녕하세요. 저는 이영입니다.', '만나서 반갑습니다.']);
  assert.deepEqual(splitGuess('정말? 「그래」 다음에 보자'), ['정말?', '「그래」 다음에 보자']);
  assert.deepEqual(splitGuess('응, 늦어서 미안해.'), ['응, 늦어서', '미안해.']);
  assert.deepEqual(splitGuess('가나다라'), ['가나', '다라']);
  assert.deepEqual(splitGuess('가'), ['', '가']);
});

test('reading.script(SOMA-816): 아래에 추가는 처음에 상대 배역을 고르고, 배역이 없으면 지문이다', () => {
  assert.equal(defaultInsertSpeaker(['c1', 'c2'], 'c1'), 'c2');
  assert.equal(defaultInsertSpeaker(['c1', 'c2'], 'c2'), 'c1', '마지막 배역 다음은 처음으로 돈다');
  assert.equal(defaultInsertSpeaker(['c1', 'c2'], null), 'c1', '지문·장면 아래면 첫 배역');
  assert.equal(defaultInsertSpeaker(['c1'], 'c1'), 'c1', '배역이 하나면 그 배역');
  assert.equal(defaultInsertSpeaker([], null), 'direction');
});

test('reading.script(SOMA-816): 아래에 추가는 글이 있어야 하고, 지문이면 배역 없이 보낸다', () => {
  assert.equal(canInsertLine({ speaker: 'c1', text: '  ' }), false);
  assert.equal(canInsertLine({ speaker: 'direction', text: '(사이)' }), true);
  assert.deepEqual(insertLineOf({ speaker: 'c1', text: ' 안녕 ' }), { kind: 'dialogue', characterId: 'c1', text: '안녕' });
  assert.deepEqual(insertLineOf({ speaker: 'direction', text: ' (사이) ' }), { kind: 'direction', characterId: null, text: '(사이)' });
});
