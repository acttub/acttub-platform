import assert from 'node:assert/strict';
import test from 'node:test';

import { pronunciationNotes } from '../lib/reading/pronunciation-notes.ts';

test('pronunciation-notes: 대본과 똑같이 들렸으면 짚을 곳이 없다 — 띄어쓰기·문장부호는 보지 않는다', () => {
  assert.deepEqual(pronunciationNotes('달라지지. 나는 알잖아, 네가 그거 얼마나 준비했는지.', '달라지지 나는 알잖아 네가그거 얼마나 준비했는지'), []);
});

test('pronunciation-notes: 다르게 들린 어절을 들린 말과 함께 짚는다', () => {
  assert.deepEqual(pronunciationNotes('달라지지. 나는 알잖아, 네가 그거 얼마나 준비했는지.', '달라지지 나는 알잖아 네가 그거 얼마나 준미했는지'), [
    { word: '준비했는지', heard: '준미했는지' },
  ]);
  assert.deepEqual(pronunciationNotes('말하면 뭐가 달라져.', '말하면 머가 달라져'), [{ word: '뭐가', heard: '머가' }]);
});

test('pronunciation-notes: 빠진 어절은 들린 말 없이 짚는다', () => {
  assert.deepEqual(pronunciationNotes('나가! 당장 내 눈앞에서 사라지라고!', '나가 내 눈앞에서 사라지라고'), [{ word: '당장', heard: '' }]);
});

test('pronunciation-notes: 어미·조사 끝 한 글자만 다르면(했어/했어요, 가잖아/가잖아요) 짚지 않는다', () => {
  assert.deepEqual(pronunciationNotes('왜 말 안 했어.', '왜 말 안 했어요'), []);
  assert.deepEqual(pronunciationNotes('너 힘들면 항상 높은 데로 가잖아.', '너 힘들면 항상 높은 데로 가잖아요'), []);
  assert.deepEqual(pronunciationNotes('그거 얼마나 준비했는지.', '그거 얼마나 준비했는데'), []);
});

test('pronunciation-notes: 대사를 거의 다르게 말했으면(애드리브·다른 줄) 어절을 짚지 않는다', () => {
  assert.deepEqual(pronunciationNotes('여기 있을 줄 알았어.', '오늘 날씨가 정말 좋네요'), []);
});

test('pronunciation-notes: 아무것도 못 들었으면 빈 목록, 한 줄에 세 개까지', () => {
  assert.deepEqual(pronunciationNotes('여기 있을 줄 알았어.', ''), []);
  const notes = pronunciationNotes(
    '엄마가 떠나던 날 나는 창문 앞에 앉아서 해가 질 때까지 기다렸어',
    '엄마가 떠나던 날 나는 장문 아페 안자서 해가 질 대까지 기다렸어',
  );
  assert.ok(notes.length <= 3);
  assert.equal(notes[0].word, '창문');
});

test('pronunciation-notes: 소리 나는 대로 받아쓴 차이(연음·ㅐ/ㅔ·받침 대표음)는 짚지 않는다 — 실녹음에서 나온 꼴', () => {
  assert.deepEqual(pronunciationNotes('알아. 그래도 혼자 하는 것보단 낫지.', '아라 그래도 혼자 하는 것보단 낫지'), []);
  assert.deepEqual(pronunciationNotes('대본은 내가 상대역 해줄게.', '대보는 내가 상대역 해줄게'), []);
  assert.deepEqual(pronunciationNotes('너 힘들면 항상 높은 데로 가잖아.', '너 힘들면 항상 높은대로 가잖아'), []);
  assert.deepEqual(pronunciationNotes('옷 입어', '옫 이버'), []);
  // 소리가 실제로 다른 것은 그대로 짚는다.
  assert.deepEqual(pronunciationNotes('가자. 춥다.', '가자 주다'), [{ word: '춥다', heard: '주다' }]);
});
