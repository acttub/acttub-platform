import assert from 'node:assert/strict';
import test from 'node:test';

import { diffWords } from '../lib/reading/word-diff.ts';

const marked = (target, said) => diffWords(target, said).filter((w) => w.differs).map((w) => w.text);

test('reading.session: 원문 어절 가운데 말한 것과 글자가 맞지 않는 어절만 표시한다', () => {
  assert.deepEqual(marked('그럼 다 달라져.', '그럼 다 바뀌어'), ['달라져.']);
  assert.deepEqual(
    diffWords('그럼 다 달라져.', '그럼 다 바뀌어').map((w) => w.text),
    ['그럼', '다', '달라져.'],
    '원문 어절을 순서대로 모두 돌려준다',
  );
});

test('reading.session: 띄어쓰기·문장부호는 무시한다', () => {
  assert.deepEqual(marked('여기 있을 줄 알았어.', '여기있을줄 알았어'), []);
});

test('reading.session: 빠진 말은 표시하고 더한 말은 원문에 표시하지 않는다', () => {
  assert.deepEqual(marked('나는 정말 몰랐어', '나는 몰랐어'), ['정말']);
  assert.deepEqual(marked('몰랐어', '진짜 나는 몰랐어'), []);
});

test('reading.session: 괄호 안 지시는 비교하지 않는다', () => {
  assert.deepEqual(marked('(웃으며) 그런가, 정말?', '그런가 정말'), []);
  assert.deepEqual(marked('(웃으며 돌아서서) 그런가', ''), ['그런가']);
});

test('reading.session: 아무 말도 없으면 원문 어절이 모두 표시된다', () => {
  assert.deepEqual(marked('가자 이제', ''), ['가자', '이제']);
});
