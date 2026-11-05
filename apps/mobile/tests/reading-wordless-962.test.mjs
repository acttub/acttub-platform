import assert from 'node:assert/strict';
import test from 'node:test';

import { isWordless } from '../lib/reading/line-coverage.ts';

test('SOMA-962: 말줄임표·줄표·괄호 지문뿐인 줄은 소리 낼 글자가 없는 쉬는 줄이다', () => {
  for (const text of ['...', '……', '…', '—', '- -', '(한숨) ...', '(고개를 돌린다)', '', '  ', '?!']) {
    assert.equal(isWordless(text), true, text);
  }
});

test('SOMA-962: 글자·숫자·낱자모가 하나라도 있으면 대사다', () => {
  for (const text of ['네...', '...응', '(웃으며) 그래.', 'ㅋㅋㅋ', '3...', 'Hi...']) {
    assert.equal(isWordless(text), false, text);
  }
});

test('괄호가 닫히지 않은 줄은 쉬는 줄이 아니다 — 지문이 다음 줄로 넘어간 대본에서 상대 대사가 통째로 빠졌다(11/5 제보)', () => {
  for (const text of ['(문을 열며 그래, 들어와', '[전화 너머 여보세요?', '（웃으며 그래', '【무대 밖 누구세요']) {
    assert.equal(isWordless(text), false, text);
  }
  // 닫힌 괄호 안만 지문이다.
  assert.equal(isWordless('(고개를 돌린다) (한숨)'), true);
});
