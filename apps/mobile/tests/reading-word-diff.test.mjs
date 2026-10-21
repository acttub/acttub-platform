import assert from 'node:assert/strict';
import test from 'node:test';

import { diffWords } from '../lib/reading/word-diff.ts';

const marked = (target, said) => diffWords(target, said).filter((w) => w.differs).map((w) => w.text);

test('reading.session(SOMA-785): 빠뜨리거나 바꿔 말한 원문 어절만 표시한다 — 서버 WordDiff 와 같은 검증 예', () => {
  assert.deepEqual(marked('그래서 더 말하기 싫었어.', '그래서 말하기 싫었어'), ['더']);
  assert.deepEqual(marked('말하면 뭐가 달라져.', '말하면 뭐가 달라'), ['달라져.']);
  assert.deepEqual(marked('나는 정말 몰랐어', '나는 몰랐어'), ['정말']);
});

test('reading.session(SOMA-785): 띄어쓰기·문장부호·괄호 지시·낱자모 추임새·대소문자는 비교하지 않고, 더한 말은 표시하지 않는다', () => {
  assert.deepEqual(marked('(웃으며) 그런가... ㅎㅎ', '그 런 가'), []);
  assert.deepEqual(marked('OK 가자!', 'ok가자 정말'), []);
  assert.deepEqual(diffWords('  오늘   왔구나. ', '오늘'), [
    { text: '오늘', differs: false },
    { text: '왔구나.', differs: true },
  ]);
});

test('reading.session(SOMA-785): 너무 긴 글은 표시 없이 어절만 돌려준다', () => {
  const long = '가'.repeat(1001);
  assert.deepEqual(diffWords(long, '나'), [{ text: long, differs: false }]);
});
