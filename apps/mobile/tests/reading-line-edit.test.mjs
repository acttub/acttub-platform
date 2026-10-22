import assert from 'node:assert/strict';
import test from 'node:test';

import { canSaveLineDraft, linePatch, splitGuess } from '../lib/reading/line-edit.ts';

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
